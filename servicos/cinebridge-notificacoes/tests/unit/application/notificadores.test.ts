import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ListarNotificacoes } from '../../../src/application/listar-notificacoes.js';
import { NotificadorEmail } from '../../../src/application/notificador-email.js';
import { NotificadorInterno } from '../../../src/application/notificador-interno.js';
import type { MensagemRecebida } from '../../../src/application/ports/observador-mensagem.js';
import type { EventoProjeto } from '../../../src/contratos/eventos-projetos.js';
import { ConexaoRabbitMQ } from '../../../src/infrastructure/mensageria/conexao-rabbitmq.js';
import { ConsumidorFila } from '../../../src/infrastructure/mensageria/consumidor-fila.js';
import { ehEventoProjeto } from '../../../src/contratos/eventos-projetos.js';
import {
  CONFIG_RABBITMQ,
  criarConectorFalso,
  criarLoggerFalso,
  liberarTarefas,
} from '../infrastructure/mensageria/dubles-rabbitmq.js';
import { DETALHES_POR_MOTIVO, criarEventoProjeto } from '../fixtures/eventos-projetos.js';
import { RepositorioEmMemoria } from '../fixtures/repositorio-em-memoria.js';

function mensagem(evento: EventoProjeto, reentregue = false): MensagemRecebida<EventoProjeto> {
  return {
    fila: 'eventos-projetos',
    conteudo: evento,
    propriedades: { messageId: evento.id, headers: {} },
    reentregue,
  };
}

function eventoCriado(id = 'saida-1'): EventoProjeto {
  return criarEventoProjeto({
    id,
    tipo: 'PROJETO_CRIADO',
    status: 'CRIADO',
    motivo: 'RECOMENDACAO_GERADA',
    detalhe: DETALHES_POR_MOTIVO.RECOMENDACAO_GERADA,
  });
}

function montar() {
  const repositorio = new RepositorioEmMemoria();
  const { logger, mensagens } = criarLoggerFalso();
  const email = new NotificadorEmail(repositorio, logger);
  const interno = new NotificadorInterno(repositorio, logger);
  return { repositorio, logger, mensagens, email, interno };
}

describe('NotificadorEmail', () => {
  it('grava os avisos no canal EMAIL e registra o envio no log', async () => {
    const { repositorio, logger, mensagens, email } = montar();

    await email.atualizar(mensagem(eventoCriado()));

    expect(repositorio.linhas.map((linha) => [linha.destinatarioId, linha.canal])).toEqual([
      ['produtor-1', 'EMAIL'],
      ['prof-1', 'EMAIL'],
      ['prof-2', 'EMAIL'],
    ]);
    expect(mensagens('info')).toEqual([
      'E-mail enviado para produtor-1: Projeto registrado: Curta na Serra',
      'E-mail enviado para prof-1: Um produtor tem interesse no seu perfil',
      'E-mail enviado para prof-2: Um produtor tem interesse no seu perfil',
    ]);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        canal: 'EMAIL',
        destinatarioId: 'prof-1',
        assunto: 'Um produtor tem interesse no seu perfil',
        correlationId: 'req-1',
        eventoId: 'saida-1',
        projetoId: 'projeto-1',
      }),
      expect.any(String),
    );
  });

  it('grava o evento com os campos de rastreio e sem correlação quando ela não existe', async () => {
    const { repositorio, email } = montar();

    await email.atualizar(
      mensagem(
        criarEventoProjeto({ correlacaoId: null, tipo: 'PROJETO_CRIADO', status: 'CRIADO' }),
      ),
    );

    expect(repositorio.tentativas[0]).toMatchObject({
      eventoId: 'saida-1',
      tipoEvento: 'PROJETO_CRIADO',
      projetoId: 'projeto-1',
      canal: 'EMAIL',
    });
    expect(repositorio.tentativas[0]).not.toHaveProperty('correlacaoId');
  });

  it('a reentrega do mesmo evento não duplica linha nem log de envio', async () => {
    const { repositorio, mensagens, email } = montar();
    const evento = eventoCriado();

    await email.atualizar(mensagem(evento));
    await email.atualizar(mensagem(evento, true));

    expect(repositorio.linhas).toHaveLength(3);
    expect(mensagens('info').filter((texto) => texto.startsWith('E-mail enviado'))).toHaveLength(3);
    expect(mensagens('info').filter((texto) => texto.startsWith('E-mail já enviado'))).toHaveLength(
      3,
    );
  });

  it('um evento diferente com os mesmos destinatários gera novos avisos', async () => {
    const { repositorio, email } = montar();

    await email.atualizar(mensagem(eventoCriado('saida-1')));
    await email.atualizar(mensagem(eventoCriado('saida-2')));

    expect(repositorio.linhas).toHaveLength(6);
  });

  it('propaga a falha do banco sem registrar envio dos avisos que não foram gravados', async () => {
    const { repositorio, mensagens, email } = montar();
    repositorio.falharNoCanal = 'EMAIL';
    repositorio.falhasRestantes = 1;

    await expect(email.atualizar(mensagem(eventoCriado()))).rejects.toThrow('banco indisponível');

    expect(repositorio.linhas).toHaveLength(0);
    expect(mensagens('info')).toEqual([]);
  });

  it('retoma de onde parou: só os avisos pendentes são enviados na nova tentativa', async () => {
    const { repositorio, mensagens, email } = montar();
    await repositorio.registrar({
      eventoId: 'saida-1',
      tipoEvento: 'PROJETO_CRIADO',
      motivo: 'RECOMENDACAO_GERADA',
      projetoId: 'projeto-1',
      destinatarioId: 'produtor-1',
      tipoDestinatario: 'PRODUTOR',
      canal: 'EMAIL',
      assunto: 'Projeto registrado: Curta na Serra',
      corpo: 'já gravado antes da falha',
    });

    await email.atualizar(mensagem(eventoCriado(), true));

    expect(repositorio.linhas).toHaveLength(3);
    expect(
      mensagens('info').filter((texto) => texto.startsWith('E-mail enviado para prof')),
    ).toHaveLength(2);
    expect(mensagens('info').filter((texto) => texto.includes('produtor-1'))).toEqual([
      'E-mail já enviado antes para produtor-1; envio repetido ignorado',
    ]);
  });
});

describe('NotificadorInterno', () => {
  it('grava os avisos no canal INTERNA e registra a entrega', async () => {
    const { repositorio, mensagens, interno } = montar();

    await interno.atualizar(mensagem(eventoCriado()));

    expect(repositorio.linhas.every((linha) => linha.canal === 'INTERNA')).toBe(true);
    expect(repositorio.linhas).toHaveLength(3);
    expect(mensagens('info')[0]).toBe(
      'Mensagem interna entregue para produtor-1: Projeto registrado: Curta na Serra',
    );
  });

  it('a reentrega não duplica linha nem log', async () => {
    const { repositorio, mensagens, interno } = montar();
    const evento = eventoCriado();

    await interno.atualizar(mensagem(evento));
    await interno.atualizar(mensagem(evento, true));

    expect(repositorio.linhas).toHaveLength(3);
    expect(mensagens('info')).toHaveLength(3);
  });

  it('não grava nada para eventos sem aviso', async () => {
    const { repositorio, interno } = montar();

    await interno.atualizar(mensagem(criarEventoProjeto()));

    expect(repositorio.tentativas).toEqual([]);
  });
});

describe('os dois observadores no consumidor de eventos-projetos', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function montarConsumidor() {
    const conector = criarConectorFalso();
    const { logger, mensagens } = criarLoggerFalso();
    const conexao = new ConexaoRabbitMQ(CONFIG_RABBITMQ, logger, {
      intervaloReconexaoMs: 1_000,
      conectar: conector.conectar,
    });
    await conexao.iniciar();
    const repositorio = new RepositorioEmMemoria();
    const consumidor = new ConsumidorFila<EventoProjeto>(
      conexao,
      {
        fila: 'eventos-projetos',
        prefetch: 10,
        validar: ehEventoProjeto,
        atrasoNovaTentativaMs: 5_000,
      },
      logger,
    );
    consumidor.adicionarObservador(new NotificadorEmail(repositorio, logger));
    consumidor.adicionarObservador(new NotificadorInterno(repositorio, logger));
    await consumidor.iniciar();
    return { canal: conector.ultimoModelo.ultimoCanal, consumidor, repositorio, mensagens };
  }

  it('os dois canais recebem a mesma mensagem e ela recebe ack', async () => {
    const { canal, consumidor, repositorio } = await montarConsumidor();
    expect(consumidor.nomesObservadores).toEqual(['notificador-email', 'notificador-interno']);

    canal.entregar('eventos-projetos', eventoCriado(), { messageId: 'saida-1' });
    await vi.advanceTimersByTimeAsync(0);

    expect(canal.acks).toHaveLength(1);
    expect(canal.nacks).toHaveLength(0);
    expect(repositorio.linhas.filter((linha) => linha.canal === 'EMAIL')).toHaveLength(3);
    expect(repositorio.linhas.filter((linha) => linha.canal === 'INTERNA')).toHaveLength(3);
  });

  it('falha de um canal devolve a mensagem e a repetição não duplica o canal que deu certo', async () => {
    const { canal, repositorio, mensagens } = await montarConsumidor();
    repositorio.falharNoCanal = 'INTERNA';
    repositorio.falhasRestantes = 1;
    const evento = eventoCriado();

    canal.entregar('eventos-projetos', evento, { messageId: 'saida-1' });
    await vi.advanceTimersByTimeAsync(5_000);

    expect(canal.acks).toHaveLength(0);
    expect(canal.nacks).toEqual([expect.objectContaining({ requeue: true })]);
    expect(repositorio.linhas.filter((linha) => linha.canal === 'EMAIL')).toHaveLength(3);
    expect(repositorio.linhas.filter((linha) => linha.canal === 'INTERNA')).toHaveLength(0);

    canal.entregar('eventos-projetos', evento, { messageId: 'saida-1' }, true);
    await vi.advanceTimersByTimeAsync(0);
    await liberarTarefas();

    expect(canal.acks).toHaveLength(1);
    expect(repositorio.linhas).toHaveLength(6);
    expect(mensagens('info').filter((texto) => texto.startsWith('E-mail enviado'))).toHaveLength(3);
  });

  it('descarta sem reenfileirar o evento fora do contrato', async () => {
    const { canal, repositorio } = await montarConsumidor();

    canal.entregar('eventos-projetos', { id: 'x', tipo: 'OUTRO' });
    await vi.advanceTimersByTimeAsync(0);

    expect(canal.nacks).toEqual([expect.objectContaining({ requeue: false })]);
    expect(repositorio.tentativas).toEqual([]);
  });
});

describe('ListarNotificacoes', () => {
  it('aplica o limite padrão, respeita o máximo e filtra', async () => {
    const repositorio = new RepositorioEmMemoria();
    const listar = vi.spyOn(repositorio, 'listar');
    const caso = new ListarNotificacoes(repositorio);

    await caso.executar({});
    await caso.executar({ projetoId: 'projeto-1', limite: 9_999 });
    await caso.executar({ canal: 'EMAIL', limite: 0 });

    expect(listar.mock.calls.map((chamada) => chamada[0])).toEqual([
      { limite: 50 },
      { projetoId: 'projeto-1', limite: 200 },
      { canal: 'EMAIL', limite: 1 },
    ]);
  });
});

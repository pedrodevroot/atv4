import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type {
  MensagemRecebida,
  ObservadorMensagem,
} from '../../../../src/application/ports/observador-mensagem.js';

interface ObservadorFalso {
  readonly nome: string;
  readonly atualizar: Mock<ObservadorMensagem<Pedido>['atualizar']>;
}
import { ConexaoRabbitMQ } from '../../../../src/infrastructure/mensageria/conexao-rabbitmq.js';
import { ConsumidorFila } from '../../../../src/infrastructure/mensageria/consumidor-fila.js';
import {
  CONFIG_RABBITMQ,
  criarConectorFalso,
  criarLoggerFalso,
  liberarTarefas,
} from './dubles-rabbitmq.js';

interface Pedido {
  readonly id: string;
}

const FILA = 'eventos-teste';
const ATRASO = 5_000;
const INTERVALO = 1_000;

function ehPedido(valor: unknown): valor is Pedido {
  return (
    typeof valor === 'object' &&
    valor !== null &&
    typeof (valor as { id?: unknown }).id === 'string'
  );
}

function observador(
  nome: string,
  atualizar: (mensagem: MensagemRecebida<Pedido>) => Promise<void> = async () => undefined,
): ObservadorFalso {
  return { nome, atualizar: vi.fn(atualizar) };
}

async function montar(opcoes: { iniciarConexao?: boolean; limiteDrenagemMs?: number } = {}) {
  const conector = criarConectorFalso();
  const { logger, mensagens } = criarLoggerFalso();
  const conexao = new ConexaoRabbitMQ(CONFIG_RABBITMQ, logger, {
    intervaloReconexaoMs: INTERVALO,
    conectar: conector.conectar,
  });
  const consumidor = new ConsumidorFila<Pedido>(
    conexao,
    {
      fila: FILA,
      prefetch: 4,
      validar: ehPedido,
      atrasoNovaTentativaMs: ATRASO,
      ...(opcoes.limiteDrenagemMs === undefined
        ? {}
        : { limiteDrenagemMs: opcoes.limiteDrenagemMs }),
    },
    logger,
  );
  if (opcoes.iniciarConexao ?? true) {
    await conexao.iniciar();
  }
  return {
    conector,
    conexao,
    consumidor,
    mensagens,
    canal: () => conector.ultimoModelo.ultimoCanal,
  };
}

describe('ConsumidorFila', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('declara a fila durável, aplica o prefetch e consome com ack manual', async () => {
    const { consumidor, canal, mensagens } = await montar();

    await consumidor.iniciar();

    expect(canal().declaracoes).toEqual([{ fila: FILA, opcoes: { durable: true } }]);
    expect(canal().prefetches).toEqual([4]);
    expect(canal().assinaturaDa(FILA).opcoes).toEqual({ noAck: false });
    expect(consumidor.ativo).toBe(true);
    expect(consumidor.fila).toBe(FILA);
    expect(mensagens('info')).toContain(`Consumindo a fila ${FILA}`);
  });

  it('espera a conexão quando é iniciado antes do RabbitMQ', async () => {
    const { conexao, consumidor, canal, mensagens } = await montar({ iniciarConexao: false });

    await consumidor.iniciar();
    await consumidor.iniciar();
    expect(consumidor.ativo).toBe(false);
    expect(mensagens('info')).toContain(`Aguardando o RabbitMQ para consumir a fila ${FILA}`);

    await conexao.iniciar();

    expect(consumidor.ativo).toBe(true);
    expect(canal().filasConsumidas()).toEqual([FILA]);
  });

  it('notifica todos os observadores e faz ack quando todos terminam', async () => {
    const { consumidor, canal } = await montar();
    const email = observador('email');
    const interno = observador('interno');
    consumidor.adicionarObservador(email);
    consumidor.adicionarObservador(interno);
    consumidor.adicionarObservador(email);
    await consumidor.iniciar();

    const mensagem = canal().entregar(
      FILA,
      { id: 'p1' },
      {
        messageId: 'm1',
        correlationId: 'c1',
        type: 'PEDIDO',
        replyTo: 'retorno',
        contentType: 'application/json',
        timestamp: 1_790_000_000,
        expiration: 15_000,
        headers: { origem: 'teste' },
      },
      true,
    );
    await liberarTarefas();

    expect(consumidor.nomesObservadores).toEqual(['email', 'interno']);
    expect(email.atualizar).toHaveBeenCalledOnce();
    expect(interno.atualizar).toHaveBeenCalledWith({
      fila: FILA,
      conteudo: { id: 'p1' },
      reentregue: true,
      propriedades: {
        messageId: 'm1',
        correlationId: 'c1',
        type: 'PEDIDO',
        replyTo: 'retorno',
        contentType: 'application/json',
        timestamp: 1_790_000_000,
        expiration: '15000',
        headers: { origem: 'teste' },
      },
    });
    expect(canal().acks).toEqual([mensagem]);
    expect(canal().nacks).toEqual([]);
  });

  it('normaliza propriedades ausentes ou com tipo inesperado', async () => {
    const { consumidor, canal } = await montar();
    const atento = observador('atento');
    consumidor.adicionarObservador(atento);
    await consumidor.iniciar();

    canal().entregar(FILA, { id: 'p2' }, { messageId: 42, headers: undefined, expiration: 'x' });
    await liberarTarefas();

    expect(atento.atualizar).toHaveBeenCalledWith(
      expect.objectContaining({
        propriedades: {
          messageId: undefined,
          correlationId: undefined,
          replyTo: undefined,
          type: undefined,
          contentType: undefined,
          expiration: 'x',
          timestamp: undefined,
          headers: {},
        },
      }),
    );
  });

  it('espera o atraso e devolve a mensagem à fila quando um observador falha', async () => {
    const { consumidor, canal, mensagens } = await montar();
    const ok = observador('ok');
    const falho = observador('falho', async () => {
      throw new Error('banco fora');
    });
    consumidor.adicionarObservador(ok);
    consumidor.adicionarObservador(falho);
    await consumidor.iniciar();

    const mensagem = canal().entregar(FILA, { id: 'p3' }, { messageId: 'm3' });
    await liberarTarefas();

    expect(ok.atualizar).toHaveBeenCalledOnce();
    expect(mensagens('error')).toEqual(['Observador falhou ao tratar a mensagem']);
    expect(canal().nacks).toEqual([]);
    expect(consumidor.mensagensEmAndamento).toBe(1);

    await vi.advanceTimersByTimeAsync(ATRASO);

    expect(canal().nacks).toEqual([{ mensagem, requeue: true }]);
    expect(canal().acks).toEqual([]);
    expect(consumidor.mensagensEmAndamento).toBe(0);
    expect(mensagens('warn')).toContain('Mensagem devolvida à fila para nova tentativa');
  });

  it('devolve a mensagem imediatamente quando o atraso é zero', async () => {
    const { conexao, canal } = await montar();
    const consumidor = new ConsumidorFila<Pedido>(
      conexao,
      { fila: FILA, prefetch: 1, validar: ehPedido, atrasoNovaTentativaMs: 0 },
      criarLoggerFalso().logger,
    );
    consumidor.adicionarObservador(
      observador('falho', async () => {
        throw new Error('falhou');
      }),
    );
    await consumidor.iniciar();

    const mensagem = canal().entregar(FILA, { id: 'p4' });
    await liberarTarefas();

    expect(canal().nacks).toEqual([{ mensagem, requeue: true }]);
  });

  it('devolve a mensagem quando não há observadores registrados', async () => {
    const { consumidor, canal, mensagens } = await montar();
    const removido = observador('removido');
    consumidor.adicionarObservador(removido);
    consumidor.removerObservador(removido);
    consumidor.removerObservador(removido);
    await consumidor.iniciar();

    const mensagem = canal().entregar(FILA, { id: 'p5' });
    await vi.advanceTimersByTimeAsync(ATRASO);

    expect(removido.atualizar).not.toHaveBeenCalled();
    expect(canal().nacks).toEqual([{ mensagem, requeue: true }]);
    expect(mensagens('error')).toEqual(['Observador falhou ao tratar a mensagem']);
  });

  it('descarta sem reentrega a mensagem com JSON inválido', async () => {
    const { consumidor, canal, mensagens } = await montar();
    const atento = observador('atento');
    consumidor.adicionarObservador(atento);
    await consumidor.iniciar();

    const mensagem = canal().entregar(FILA, Buffer.from('{quebrado'), { messageId: 'm6' });
    await liberarTarefas();

    expect(atento.atualizar).not.toHaveBeenCalled();
    expect(canal().nacks).toEqual([{ mensagem, requeue: false }]);
    expect(mensagens('warn')).toContain('Mensagem inválida descartada');
  });

  it('descarta sem reentrega a mensagem fora do contrato', async () => {
    const { consumidor, canal } = await montar();
    consumidor.adicionarObservador(observador('atento'));
    await consumidor.iniciar();

    const mensagem = canal().entregar(FILA, { outro: 'formato' });
    await liberarTarefas();

    expect(canal().nacks).toEqual([{ mensagem, requeue: false }]);
  });

  it('registra quando não consegue confirmar porque o canal caiu', async () => {
    const { consumidor, canal, mensagens } = await montar();
    let liberar: () => void = () => undefined;
    consumidor.adicionarObservador(
      observador('lento', () => new Promise<void>((resolver) => (liberar = resolver))),
    );
    await consumidor.iniciar();
    const anterior = canal();

    anterior.entregar(FILA, { id: 'p7' });
    await liberarTarefas();
    anterior.fechar();
    liberar();
    await liberarTarefas();

    expect(anterior.acks).toEqual([]);
    expect(mensagens('warn')).toContain(
      'Não foi possível confirmar a mensagem; o RabbitMQ vai reentregá-la',
    );
  });

  it('assina a fila de novo depois que a conexão cai e volta', async () => {
    const { conector, consumidor, canal } = await montar();
    await consumidor.iniciar();
    const anterior = canal();

    conector.ultimoModelo.cair();
    expect(consumidor.ativo).toBe(false);
    await vi.advanceTimersByTimeAsync(INTERVALO);

    expect(canal()).not.toBe(anterior);
    expect(canal().filasConsumidas()).toEqual([FILA]);
    expect(canal().prefetches).toEqual([4]);
    expect(consumidor.ativo).toBe(true);
  });

  it('assina de novo quando o RabbitMQ cancela o consumo', async () => {
    const { consumidor, canal, mensagens } = await montar();
    await consumidor.iniciar();

    canal().cancelarPeloServidor(FILA);
    expect(consumidor.ativo).toBe(false);
    await liberarTarefas();

    expect(canal().filasConsumidas()).toEqual([FILA]);
    expect(consumidor.ativo).toBe(true);
    expect(mensagens('warn')).toContain(
      `O RabbitMQ cancelou o consumo da fila ${FILA}; assinando de novo`,
    );
  });

  it('registra a falha quando não consegue assinar de novo após o cancelamento', async () => {
    const { consumidor, canal, mensagens } = await montar();
    await consumidor.iniciar();
    canal().falhaDeclaracao = new Error('NOT_FOUND');

    canal().cancelarPeloServidor(FILA);
    await liberarTarefas();

    expect(consumidor.ativo).toBe(false);
    expect(mensagens('error')).toContain('Falha ao assinar a fila de novo');
  });

  it('propaga a falha de declaração no iniciar e fica inativo', async () => {
    const { consumidor, canal } = await montar();
    canal().falhaDeclaracao = new Error('PRECONDITION_FAILED');

    await expect(consumidor.iniciar()).rejects.toThrow('PRECONDITION_FAILED');
    expect(consumidor.ativo).toBe(false);
  });

  it('para: cancela o consumo, espera as mensagens em andamento e não assina mais', async () => {
    const { conector, consumidor, canal, mensagens } = await montar();
    let liberar: () => void = () => undefined;
    const lento = observador('lento', () => new Promise<void>((resolver) => (liberar = resolver)));
    consumidor.adicionarObservador(lento);
    await consumidor.iniciar();
    const mensagem = canal().entregar(FILA, { id: 'p8' });
    await liberarTarefas();

    let parou = false;
    const parada = consumidor.parar().then(() => {
      parou = true;
    });
    await liberarTarefas();
    expect(canal().cancelamentos).toEqual(['etiqueta-1']);
    expect(consumidor.ativo).toBe(false);
    expect(parou).toBe(false);

    liberar();
    await parada;

    expect(canal().acks).toEqual([mensagem]);
    expect(mensagens('info')).toContain(`Consumo da fila ${FILA} encerrado`);
    await consumidor.parar();
    conector.ultimoModelo.cair();
    await vi.advanceTimersByTimeAsync(INTERVALO);
    expect(canal().filasConsumidas()).toEqual([]);
  });

  it('para sem esperar o atraso de nova tentativa', async () => {
    const { consumidor, canal } = await montar();
    consumidor.adicionarObservador(
      observador('falho', async () => {
        throw new Error('falhou');
      }),
    );
    await consumidor.iniciar();
    const mensagem = canal().entregar(FILA, { id: 'p9' });
    await liberarTarefas();

    await consumidor.parar();

    expect(canal().nacks).toEqual([{ mensagem, requeue: true }]);
  });

  it('devolve à fila as mensagens que chegam durante a parada', async () => {
    const { consumidor, canal } = await montar();
    const atento = observador('atento');
    consumidor.adicionarObservador(atento);
    await consumidor.iniciar();
    const assinatura = canal().assinaturaDa(FILA);

    await consumidor.parar();
    const mensagem = {
      content: Buffer.from(JSON.stringify({ id: 'p10' })),
      fields: {
        deliveryTag: 99,
        redelivered: false,
        exchange: '',
        routingKey: FILA,
        consumerTag: 'etiqueta-1',
      },
      properties: { headers: {} },
    } as unknown as Parameters<typeof assinatura.ouvinte>[0];
    assinatura.ouvinte(mensagem);
    await liberarTarefas();

    expect(atento.atualizar).not.toHaveBeenCalled();
    expect(canal().nacks).toEqual([{ mensagem, requeue: true }]);
  });

  it('desiste de esperar as mensagens presas depois do limite de drenagem', async () => {
    const { consumidor, canal, mensagens } = await montar({ limiteDrenagemMs: 2_000 });
    consumidor.adicionarObservador(observador('preso', () => new Promise<void>(() => undefined)));
    await consumidor.iniciar();
    canal().entregar(FILA, { id: 'p11' });
    await liberarTarefas();

    const parada = consumidor.parar();
    await vi.advanceTimersByTimeAsync(2_000);
    await parada;

    expect(mensagens('warn')).toContain(
      'Encerrando com mensagens em processamento; o RabbitMQ vai reentregá-las',
    );
  });

  it('registra quando não consegue cancelar o consumo', async () => {
    const { consumidor, canal, mensagens } = await montar();
    await consumidor.iniciar();
    canal().falhaCancelamento = new Error('canal ocupado');

    await consumidor.parar();

    expect(mensagens('warn')).toContain('Não foi possível cancelar o consumo');
  });

  it('é parado pelo encerramento da conexão antes de o canal fechar', async () => {
    const { conexao, consumidor, canal } = await montar();
    let liberar: () => void = () => undefined;
    consumidor.adicionarObservador(
      observador('lento', () => new Promise<void>((resolver) => (liberar = resolver))),
    );
    await consumidor.iniciar();
    const atual = canal();
    const mensagem = atual.entregar(FILA, { id: 'p12' });
    await liberarTarefas();

    const encerramento = conexao.encerrar();
    await liberarTarefas();
    expect(atual.fechado).toBe(false);
    liberar();
    await encerramento;

    expect(atual.acks).toEqual([mensagem]);
    expect(atual.fechado).toBe(true);
  });

  it('cancela a assinatura que termina depois de uma parada', async () => {
    const { conexao, consumidor, canal } = await montar({ iniciarConexao: false });
    await consumidor.iniciar();
    const inicio = conexao.iniciar();
    await liberarTarefas(2);
    const parada = consumidor.parar();
    await inicio;
    await parada;
    await liberarTarefas();

    expect(canal().filasConsumidas()).toEqual([]);
    expect(consumidor.ativo).toBe(false);
  });

  it('não faz nada ao parar um consumidor que nunca iniciou', async () => {
    const { consumidor, mensagens } = await montar();

    await consumidor.parar();

    expect(mensagens('info')).not.toContain(`Consumo da fila ${FILA} encerrado`);
  });
});

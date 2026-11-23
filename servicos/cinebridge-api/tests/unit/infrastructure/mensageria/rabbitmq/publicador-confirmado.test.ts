import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConexaoRabbitMQ } from '../../../../../src/infrastructure/mensageria/rabbitmq/conexao-rabbitmq.js';
import {
  PublicadorConfirmado,
  serializarCorpo,
  timestampAmqp,
} from '../../../../../src/infrastructure/mensageria/rabbitmq/publicador-confirmado.js';
import {
  CONFIG_RABBITMQ,
  criarConectorFalso,
  criarLoggerFalso,
  liberarTarefas,
} from './dubles-rabbitmq.js';

const AGORA = new Date('2026-11-22T12:00:00.000Z');
const INTERVALO = 1_000;

async function montar(opcoes: { conectar?: boolean; limiteConfirmacaoMs?: number } = {}) {
  const conector = criarConectorFalso();
  const { logger, mensagens } = criarLoggerFalso();
  const conexao = new ConexaoRabbitMQ(CONFIG_RABBITMQ, logger, {
    intervaloReconexaoMs: INTERVALO,
    conectar: conector.conectar,
  });
  const publicador = new PublicadorConfirmado(conexao, logger, {
    limiteConexaoMs: 0,
    agora: () => AGORA,
    ...(opcoes.limiteConfirmacaoMs === undefined
      ? {}
      : { limiteConfirmacaoMs: opcoes.limiteConfirmacaoMs }),
  });
  if (opcoes.conectar ?? true) {
    await conexao.iniciar();
  }
  return {
    conector,
    conexao,
    publicador,
    mensagens,
    canal: () => conector.ultimoModelo.ultimoCanal,
  };
}

describe('PublicadorConfirmado.publicar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('declara a fila, publica persistente em JSON e espera a confirmação', async () => {
    const { publicador, canal, mensagens } = await montar();
    canal().confirmacaoTravada = true;
    let confirmou = false;

    const publicacao = publicador
      .publicar(
        'eventos-projetos',
        { id: 'e1', tipo: 'PROJETO_CRIADO' },
        { messageId: 'e1', type: 'PROJETO_CRIADO', correlationId: 'c1' },
      )
      .then(() => {
        confirmou = true;
      });
    await liberarTarefas();

    expect(canal().declaracoes).toEqual([{ fila: 'eventos-projetos', opcoes: { durable: true } }]);
    expect(canal().publicacoes).toEqual([
      {
        fila: 'eventos-projetos',
        bruto: expect.any(Buffer) as Buffer,
        conteudo: { id: 'e1', tipo: 'PROJETO_CRIADO' },
        propriedades: {
          persistent: true,
          contentType: 'application/json',
          contentEncoding: 'utf-8',
          timestamp: timestampAmqp(AGORA),
          messageId: 'e1',
          type: 'PROJETO_CRIADO',
          correlationId: 'c1',
        },
      },
    ]);
    expect(confirmou).toBe(false);

    canal().confirmarPendentes();
    await publicacao;

    expect(confirmou).toBe(true);
    expect(mensagens('info')).toContain('Mensagem publicada na fila eventos-projetos');
  });

  it('repassa expiration, replyTo e cabeçalhos quando informados', async () => {
    const { publicador, canal } = await montar();

    await publicador.publicar(
      'fila-x',
      { a: 1 },
      { messageId: 'm', type: 't', expiration: '1000', replyTo: 'volta', headers: { h: 1 } },
    );

    expect(canal().publicacoes[0]?.propriedades).toMatchObject({
      expiration: '1000',
      replyTo: 'volta',
      headers: { h: 1 },
    });
    expect(canal().publicacoes[0]?.propriedades).not.toHaveProperty('correlationId');
  });

  it('declara cada fila uma vez por canal, inclusive em publicações simultâneas', async () => {
    const { publicador, canal } = await montar();
    const propriedades = { messageId: 'm', type: 't' };

    await Promise.all([
      publicador.publicar('fila-a', {}, propriedades),
      publicador.publicar('fila-a', {}, propriedades),
    ]);
    await publicador.publicar('fila-a', {}, propriedades);
    await publicador.publicar('fila-b', {}, propriedades);

    expect(canal().declaracoes.map((declaracao) => declaracao.fila)).toEqual(['fila-a', 'fila-b']);
    expect(canal().publicacoes).toHaveLength(4);
  });

  it('declara de novo no canal novo depois de uma reconexão', async () => {
    const { conector, publicador, canal } = await montar();
    await publicador.publicar('fila-a', {}, { messageId: 'm1', type: 't' });

    conector.ultimoModelo.cair();
    await vi.advanceTimersByTimeAsync(INTERVALO);
    await publicador.publicar('fila-a', {}, { messageId: 'm2', type: 't' });

    expect(canal().declaracoes).toEqual([{ fila: 'fila-a', opcoes: { durable: true } }]);
  });

  it('tenta declarar de novo quando a declaração anterior falhou', async () => {
    const { publicador, canal, mensagens } = await montar();
    canal().falhaDeclaracao = new Error('ACCESS_REFUSED');

    await expect(publicador.publicar('fila-a', {}, { messageId: 'm1', type: 't' })).rejects.toThrow(
      'ACCESS_REFUSED',
    );
    canal().falhaDeclaracao = undefined;
    await publicador.publicar('fila-a', {}, { messageId: 'm2', type: 't' });

    expect(canal().declaracoes).toHaveLength(1);
    expect(mensagens('error')).toContain('Falha ao publicar na fila fila-a');
  });

  it('rejeita com PUBLICACAO_NAO_CONFIRMADA quando o RabbitMQ recusa a mensagem', async () => {
    const { publicador, canal } = await montar();
    canal().falhaConfirmacao = new Error('message nacked');

    await expect(
      publicador.publicar('fila-a', {}, { messageId: 'm', type: 't' }),
    ).rejects.toMatchObject({ codigo: 'PUBLICACAO_NAO_CONFIRMADA' });
  });

  it('rejeita com PUBLICACAO_NAO_CONFIRMADA quando a confirmação não chega no limite', async () => {
    const { publicador, canal } = await montar({ limiteConfirmacaoMs: 3_000 });
    canal().confirmacaoTravada = true;

    const publicacao = publicador.publicar('fila-a', {}, { messageId: 'm', type: 't' });
    const verificacao = expect(publicacao).rejects.toMatchObject({
      codigo: 'PUBLICACAO_NAO_CONFIRMADA',
      message: 'O RabbitMQ não confirmou a publicação em 3000 ms',
    });
    await vi.advanceTimersByTimeAsync(3_000);
    await verificacao;
  });

  it('rejeita com RABBITMQ_INDISPONIVEL quando não há conexão', async () => {
    const { publicador } = await montar({ conectar: false });

    await expect(
      publicador.publicar('fila-a', {}, { messageId: 'm', type: 't' }),
    ).rejects.toMatchObject({ codigo: 'RABBITMQ_INDISPONIVEL' });
  });

  it('rejeita com RABBITMQ_INDISPONIVEL quando o canal fecha no meio da publicação', async () => {
    const { publicador, canal } = await montar();
    await publicador.publicar('fila-a', {}, { messageId: 'm1', type: 't' });
    canal().fechado = true;

    await expect(
      publicador.publicar('fila-a', {}, { messageId: 'm2', type: 't' }),
    ).rejects.toMatchObject({ codigo: 'RABBITMQ_INDISPONIVEL' });
  });
});

describe('PublicadorConfirmado.responder', () => {
  it('publica no replyTo sem declarar a fila e com o mesmo correlationId', async () => {
    const { publicador, canal, mensagens } = await montar();

    await publicador.responder(
      'consulta-profissionais.resposta.abc',
      'abc',
      { sucesso: true },
      { messageId: 'r1', type: 'RESPOSTA_PROFISSIONAIS' },
    );

    expect(canal().declaracoes).toEqual([]);
    expect(canal().publicacoes[0]).toMatchObject({
      fila: 'consulta-profissionais.resposta.abc',
      conteudo: { sucesso: true },
      propriedades: {
        correlationId: 'abc',
        messageId: 'r1',
        type: 'RESPOSTA_PROFISSIONAIS',
        contentType: 'application/json',
        contentEncoding: 'utf-8',
        timestamp: timestampAmqp(AGORA),
      },
    });
    expect(mensagens('info')).toContain(
      'Resposta publicada na fila de retorno consulta-profissionais.resposta.abc',
    );
  });

  it('gera um messageId quando não é informado', async () => {
    const { publicador, canal } = await montar();

    await publicador.responder('volta', 'c2', {});

    expect(canal().publicacoes[0]?.propriedades.messageId).toEqual(expect.any(String));
    expect(canal().publicacoes[0]?.propriedades).not.toHaveProperty('type');
  });

  it('propaga e registra a falha de confirmação', async () => {
    const { publicador, canal, mensagens } = await montar();
    canal().falhaConfirmacao = new Error('channel closed');

    await expect(publicador.responder('volta', 'c3', {})).rejects.toMatchObject({
      codigo: 'PUBLICACAO_NAO_CONFIRMADA',
    });
    expect(mensagens('error')).toContain('Falha ao publicar a resposta');
  });
});

describe('utilitários de publicação', () => {
  it('serializa o corpo em JSON UTF-8 e converte o timestamp para segundos', () => {
    expect(serializarCorpo({ texto: 'ação' }).toString('utf8')).toBe('{"texto":"ação"}');
    expect(timestampAmqp(new Date('1970-01-01T00:00:01.999Z'))).toBe(1);
  });

  it('usa o relógio real e o limite padrão quando não recebe opções', async () => {
    const conector = criarConectorFalso();
    const { logger } = criarLoggerFalso();
    const conexao = new ConexaoRabbitMQ(CONFIG_RABBITMQ, logger, { conectar: conector.conectar });
    await conexao.iniciar();
    const publicador = new PublicadorConfirmado(conexao, logger);

    await publicador.publicar('fila-a', {}, { messageId: 'm', type: 't' });

    const timestamp = conector.ultimoModelo.ultimoCanal.publicacoes[0]?.propriedades.timestamp;
    expect(timestamp).toBeGreaterThan(timestampAmqp(new Date('2020-01-01T00:00:00Z')));
  });
});

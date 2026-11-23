import type { ConsumeMessage } from 'amqplib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClienteRpc } from '../../../../../src/infrastructure/mensageria/rabbitmq/cliente-rpc.js';
import { ConexaoRabbitMQ } from '../../../../../src/infrastructure/mensageria/rabbitmq/conexao-rabbitmq.js';
import {
  CONFIG_RABBITMQ,
  criarConectorFalso,
  criarLoggerFalso,
  liberarTarefas,
  type CanalFalso,
  type Publicacao,
} from './dubles-rabbitmq.js';

interface Resposta {
  readonly total: number;
}

const FILA = 'consulta-profissionais';
const PREFIXO = 'consulta-profissionais.resposta.';
const TIMEOUT = 15_000;

function ehResposta(valor: unknown): valor is Resposta {
  return (
    typeof valor === 'object' &&
    valor !== null &&
    typeof (valor as { total?: unknown }).total === 'number'
  );
}

function responder(
  canal: CanalFalso,
  publicacao: Publicacao,
  conteudo: unknown,
  correlationId?: string,
) {
  const replyTo = String(publicacao.propriedades.replyTo);
  return canal.entregar(replyTo, conteudo, {
    correlationId: correlationId ?? publicacao.propriedades.correlationId,
  });
}

async function montar(opcoes: { conectar?: boolean } = {}) {
  const conector = criarConectorFalso();
  const { logger, mensagens } = criarLoggerFalso();
  const conexao = new ConexaoRabbitMQ(CONFIG_RABBITMQ, logger, { conectar: conector.conectar });
  let sequencia = 0;
  const cliente = new ClienteRpc<Resposta>(
    conexao,
    {
      filaRequisicao: FILA,
      prefixoResposta: PREFIXO,
      timeoutMs: TIMEOUT,
      validarResposta: ehResposta,
      limiteConexaoMs: 0,
      gerarId: () => {
        sequencia += 1;
        return `uuid-${sequencia}`;
      },
      agora: () => new Date('2026-11-22T12:00:00.000Z'),
    },
    logger,
  );
  if (opcoes.conectar ?? true) {
    await conexao.iniciar();
  }
  return { conector, conexao, cliente, mensagens, canal: () => conector.ultimoModelo.ultimoCanal };
}

describe('ClienteRpc', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('publica com replyTo e correlationId únicos e resolve com a resposta certa', async () => {
    const { cliente, canal, mensagens } = await montar();
    canal().aoPublicar = (publicacao) => {
      responder(canal(), publicacao, { total: 3 });
    };

    const resposta = await cliente.solicitar(
      { operacao: 'listar-ativos' },
      'CONSULTA_PROFISSIONAIS',
      {
        messageId: 'envelope-1',
      },
    );

    expect(resposta).toEqual({ total: 3 });
    expect(canal().declaracoes).toEqual([
      { fila: FILA, opcoes: { durable: true } },
      { fila: `${PREFIXO}uuid-1`, opcoes: { durable: true, exclusive: true } },
    ]);
    expect(canal().publicacoes[0]).toMatchObject({
      fila: FILA,
      conteudo: { operacao: 'listar-ativos' },
      propriedades: {
        persistent: true,
        contentType: 'application/json',
        contentEncoding: 'utf-8',
        messageId: 'envelope-1',
        type: 'CONSULTA_PROFISSIONAIS',
        correlationId: 'uuid-1',
        replyTo: `${PREFIXO}uuid-1`,
        expiration: '15000',
        timestamp: 1_795_348_800,
      },
    });
    expect(canal().acks).toHaveLength(1);
    expect(canal().cancelamentos).toEqual(['etiqueta-1']);
    expect(canal().filasApagadas).toEqual([`${PREFIXO}uuid-1`]);
    expect(cliente.solicitacoesPendentes).toBe(0);
    expect(mensagens('info')).toEqual(
      expect.arrayContaining([
        `Consulta publicada na fila ${FILA}`,
        `Resposta recebida na fila ${PREFIXO}uuid-1`,
      ]),
    );
  });

  it('ignora a resposta com outro correlationId e espera a correta', async () => {
    const { cliente, canal, mensagens } = await montar();
    let publicada: Publicacao | undefined;
    canal().aoPublicar = (publicacao) => {
      publicada = publicacao;
    };

    const solicitacao = cliente.solicitar({}, 'CONSULTA');
    await liberarTarefas();
    if (!publicada) {
      throw new Error('a consulta não foi publicada');
    }
    responder(canal(), publicada, { total: 99 }, 'outra-consulta');
    responder(canal(), publicada, { total: 1 });

    await expect(solicitacao).resolves.toEqual({ total: 1 });
    expect(canal().acks).toHaveLength(2);
    expect(mensagens('warn')).toContain('Resposta com correlationId inesperado ignorada');
  });

  it('expira no timeout com serviço indisponível e apaga a fila de retorno', async () => {
    const { cliente, canal, mensagens } = await montar();

    const solicitacao = cliente.solicitar({}, 'CONSULTA');
    const verificacao = expect(solicitacao).rejects.toMatchObject({
      name: 'ErroMensageria',
      codigo: 'RESPOSTA_NAO_RECEBIDA',
      message: `Sem resposta na fila ${FILA} em ${TIMEOUT} ms; serviço indisponível`,
    });
    await vi.advanceTimersByTimeAsync(TIMEOUT);
    await verificacao;

    expect(canal().cancelamentos).toEqual(['etiqueta-1']);
    expect(canal().filasApagadas).toEqual([`${PREFIXO}uuid-1`]);
    expect(cliente.solicitacoesPendentes).toBe(0);
    expect(mensagens('warn')).toContain(
      'Consulta sem resposta dentro do prazo; serviço indisponível',
    );
  });

  it('ignora sem erro a resposta ou o cancelamento que chegam depois do prazo', async () => {
    const { cliente, canal } = await montar();
    const solicitacao = cliente.solicitar({}, 'CONSULTA');
    const verificacao = expect(solicitacao).rejects.toMatchObject({
      codigo: 'RESPOSTA_NAO_RECEBIDA',
    });
    await liberarTarefas();
    const ouvinte = canal().assinaturaDa(`${PREFIXO}uuid-1`).ouvinte;
    await vi.advanceTimersByTimeAsync(TIMEOUT);
    await verificacao;
    const tardia = {
      content: Buffer.from(JSON.stringify({ total: 1 })),
      fields: {
        deliveryTag: 7,
        redelivered: false,
        exchange: '',
        routingKey: 'x',
        consumerTag: 'y',
      },
      properties: { correlationId: 'uuid-1', headers: {} },
    } as unknown as ConsumeMessage;

    expect(() => {
      ouvinte(tardia);
      ouvinte(null);
    }).not.toThrow();
    expect(canal().acks).toContain(tardia);
  });

  it('rejeita com RESPOSTA_INVALIDA quando a resposta está fora do contrato ou não é JSON', async () => {
    const { cliente, canal } = await montar();
    canal().aoPublicar = (publicacao) => {
      responder(canal(), publicacao, { outro: 'formato' });
    };
    await expect(cliente.solicitar({}, 'CONSULTA')).rejects.toMatchObject({
      codigo: 'RESPOSTA_INVALIDA',
    });

    canal().aoPublicar = (publicacao) => {
      responder(canal(), publicacao, Buffer.from('{quebrado'));
    };
    await expect(cliente.solicitar({}, 'CONSULTA')).rejects.toMatchObject({
      codigo: 'RESPOSTA_INVALIDA',
    });
    expect(canal().filasApagadas).toEqual([`${PREFIXO}uuid-1`, `${PREFIXO}uuid-2`]);
  });

  it('rejeita na hora quando o canal fecha antes da resposta', async () => {
    const { cliente, canal } = await montar();
    const atual = canal();

    const solicitacao = cliente.solicitar({}, 'CONSULTA');
    const verificacao = expect(solicitacao).rejects.toMatchObject({
      codigo: 'RABBITMQ_INDISPONIVEL',
      message: 'O canal do RabbitMQ fechou antes da resposta',
    });
    await liberarTarefas();
    atual.fechar();

    await verificacao;
    expect(cliente.solicitacoesPendentes).toBe(0);
  });

  it('rejeita quando o RabbitMQ remove a fila de retorno', async () => {
    const { cliente, canal } = await montar();

    const solicitacao = cliente.solicitar({}, 'CONSULTA');
    await liberarTarefas();
    canal().cancelarPeloServidor(`${PREFIXO}uuid-1`);

    await expect(solicitacao).rejects.toMatchObject({ codigo: 'RABBITMQ_INDISPONIVEL' });
  });

  it('atende solicitações simultâneas, cada uma na sua fila de retorno', async () => {
    const { cliente, canal } = await montar();
    const publicadas: Publicacao[] = [];
    canal().aoPublicar = (publicacao) => {
      publicadas.push(publicacao);
    };

    const primeira = cliente.solicitar({ n: 1 }, 'CONSULTA');
    const segunda = cliente.solicitar({ n: 2 }, 'CONSULTA');
    await liberarTarefas(20);
    expect(cliente.solicitacoesPendentes).toBe(2);
    const [publicacaoA, publicacaoB] = publicadas;
    if (!publicacaoA || !publicacaoB) {
      throw new Error('as consultas não foram publicadas');
    }
    responder(canal(), publicacaoB, { total: 2 });
    responder(canal(), publicacaoA, { total: 1 });

    await expect(primeira).resolves.toEqual({ total: 1 });
    await expect(segunda).resolves.toEqual({ total: 2 });
    expect(new Set(publicadas.map((publicacao) => publicacao.propriedades.replyTo)).size).toBe(2);
  });

  it('não publica e registra quando o RabbitMQ está fora', async () => {
    const { cliente, mensagens } = await montar({ conectar: false });

    await expect(cliente.solicitar({}, 'CONSULTA')).rejects.toMatchObject({
      codigo: 'RABBITMQ_INDISPONIVEL',
    });
    expect(mensagens('warn')).toContain('Consulta não enviada: RabbitMQ indisponível');
  });

  it('limpa a fila de retorno quando a publicação não é confirmada', async () => {
    const { cliente, canal, mensagens } = await montar();
    canal().falhaConfirmacao = new Error('message nacked');

    await expect(cliente.solicitar({}, 'CONSULTA')).rejects.toMatchObject({
      codigo: 'PUBLICACAO_NAO_CONFIRMADA',
    });
    expect(canal().filasApagadas).toEqual([`${PREFIXO}uuid-1`]);
    expect(mensagens('warn')).toContain('Consulta pela fila falhou');
  });

  it('não tenta cancelar consumo quando a declaração da fila falha e ignora erros de limpeza', async () => {
    const { cliente, canal } = await montar();
    canal().falhaDeclaracao = new Error('RESOURCE_LOCKED');
    canal().deleteQueue = () => Promise.reject(new Error('canal fechado'));

    await expect(cliente.solicitar({}, 'CONSULTA')).rejects.toThrow('RESOURCE_LOCKED');
    expect(canal().cancelamentos).toEqual([]);
  });

  it('registra quando não consegue confirmar a resposta recebida', async () => {
    const { cliente, canal, mensagens } = await montar();
    canal().aoPublicar = (publicacao) => {
      canal().ack = () => {
        throw new Error('Channel closed');
      };
      responder(canal(), publicacao, { total: 5 });
    };

    await expect(cliente.solicitar({}, 'CONSULTA')).resolves.toEqual({ total: 5 });
    expect(mensagens('warn')).toContain('Não foi possível confirmar a resposta');
  });

  it('usa randomUUID e o relógio real por padrão', async () => {
    const conector = criarConectorFalso();
    const { logger } = criarLoggerFalso();
    const conexao = new ConexaoRabbitMQ(CONFIG_RABBITMQ, logger, { conectar: conector.conectar });
    await conexao.iniciar();
    const cliente = new ClienteRpc<Resposta>(
      conexao,
      {
        filaRequisicao: FILA,
        prefixoResposta: PREFIXO,
        timeoutMs: TIMEOUT,
        validarResposta: ehResposta,
      },
      logger,
    );
    const canal = conector.ultimoModelo.ultimoCanal;
    canal.aoPublicar = (publicacao) => {
      responder(canal, publicacao, { total: 0 });
    };

    await cliente.solicitar({}, 'CONSULTA');

    expect(String(canal.publicacoes[0]?.propriedades.correlationId)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

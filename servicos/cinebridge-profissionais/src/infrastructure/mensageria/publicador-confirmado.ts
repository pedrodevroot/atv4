import { randomUUID } from 'node:crypto';
import type { ConfirmChannel, Options } from 'amqplib';
import {
  DECLARACAO_FILA_DURAVEL,
  ErroMensageria,
  descreverErro,
  type ConexaoRabbitMQ,
  type LoggerMensageria,
} from './conexao-rabbitmq.js';

export interface PropriedadesPublicacao {
  readonly messageId: string;
  readonly type: string;
  readonly correlationId?: string;
  readonly expiration?: string;
  readonly replyTo?: string;
  readonly headers?: Readonly<Record<string, unknown>>;
}

export interface PropriedadesResposta {
  readonly messageId?: string;
  readonly type?: string;
}

export interface OpcoesPublicadorConfirmado {
  readonly limiteConexaoMs?: number;
  readonly limiteConfirmacaoMs?: number;
  readonly agora?: () => Date;
}

export const TIPO_CONTEUDO_JSON = 'application/json';
export const CODIFICACAO_CONTEUDO = 'utf-8';

export function serializarCorpo(corpo: object): Buffer {
  return Buffer.from(JSON.stringify(corpo), 'utf8');
}

export function timestampAmqp(data: Date): number {
  return Math.floor(data.getTime() / 1000);
}

export async function aguardarConfirmacao(canal: ConfirmChannel, limiteMs: number): Promise<void> {
  let temporizador: NodeJS.Timeout | undefined;
  const limite = new Promise<never>((_resolver, rejeitar) => {
    temporizador = setTimeout(() => {
      rejeitar(
        new ErroMensageria(
          'PUBLICACAO_NAO_CONFIRMADA',
          `O RabbitMQ não confirmou a publicação em ${limiteMs} ms`,
        ),
      );
    }, limiteMs);
  });
  try {
    await Promise.race([canal.waitForConfirms(), limite]);
  } catch (erro) {
    if (erro instanceof ErroMensageria) {
      throw erro;
    }
    throw new ErroMensageria(
      'PUBLICACAO_NAO_CONFIRMADA',
      `O RabbitMQ não confirmou a publicação: ${descreverErro(erro)}`,
      { cause: erro },
    );
  } finally {
    clearTimeout(temporizador);
  }
}

export function enviarParaFila(
  canal: ConfirmChannel,
  fila: string,
  conteudo: Buffer,
  propriedades: Options.Publish,
): void {
  try {
    canal.sendToQueue(fila, conteudo, propriedades);
  } catch (erro) {
    throw new ErroMensageria(
      'RABBITMQ_INDISPONIVEL',
      `Não foi possível publicar na fila ${fila}: ${descreverErro(erro)}`,
      { cause: erro },
    );
  }
}

export class PublicadorConfirmado {
  private readonly declaracoes = new WeakMap<ConfirmChannel, Map<string, Promise<unknown>>>();
  private readonly limiteConexaoMs: number | undefined;
  private readonly limiteConfirmacaoMs: number;
  private readonly agora: () => Date;

  constructor(
    private readonly conexao: ConexaoRabbitMQ,
    private readonly logger: LoggerMensageria,
    opcoes: OpcoesPublicadorConfirmado = {},
  ) {
    this.limiteConexaoMs = opcoes.limiteConexaoMs;
    this.limiteConfirmacaoMs = opcoes.limiteConfirmacaoMs ?? 10_000;
    this.agora = opcoes.agora ?? (() => new Date());
  }

  async publicar(fila: string, corpo: object, propriedades: PropriedadesPublicacao): Promise<void> {
    const contexto = {
      fila,
      messageId: propriedades.messageId,
      type: propriedades.type,
      correlationId: propriedades.correlationId,
    };
    try {
      const canal = await this.conexao.canal(this.limiteConexaoMs);
      await this.declarar(canal, fila);
      enviarParaFila(canal, fila, serializarCorpo(corpo), {
        persistent: true,
        contentType: TIPO_CONTEUDO_JSON,
        contentEncoding: CODIFICACAO_CONTEUDO,
        timestamp: timestampAmqp(this.agora()),
        messageId: propriedades.messageId,
        type: propriedades.type,
        ...(propriedades.correlationId === undefined
          ? {}
          : { correlationId: propriedades.correlationId }),
        ...(propriedades.expiration === undefined ? {} : { expiration: propriedades.expiration }),
        ...(propriedades.replyTo === undefined ? {} : { replyTo: propriedades.replyTo }),
        ...(propriedades.headers === undefined ? {} : { headers: { ...propriedades.headers } }),
      });
      await aguardarConfirmacao(canal, this.limiteConfirmacaoMs);
    } catch (erro) {
      this.logger.error({ ...contexto, err: erro }, `Falha ao publicar na fila ${fila}`);
      throw erro;
    }
    this.logger.info(contexto, `Mensagem publicada na fila ${fila}`);
  }

  async responder(
    replyTo: string,
    correlationId: string,
    corpo: object,
    propriedades: PropriedadesResposta = {},
  ): Promise<void> {
    const messageId = propriedades.messageId ?? randomUUID();
    const contexto = { replyTo, correlationId, messageId, type: propriedades.type };
    try {
      const canal = await this.conexao.canal(this.limiteConexaoMs);
      enviarParaFila(canal, replyTo, serializarCorpo(corpo), {
        correlationId,
        messageId,
        contentType: TIPO_CONTEUDO_JSON,
        contentEncoding: CODIFICACAO_CONTEUDO,
        timestamp: timestampAmqp(this.agora()),
        ...(propriedades.type === undefined ? {} : { type: propriedades.type }),
      });
      await aguardarConfirmacao(canal, this.limiteConfirmacaoMs);
    } catch (erro) {
      this.logger.error({ ...contexto, err: erro }, 'Falha ao publicar a resposta');
      throw erro;
    }
    this.logger.info(contexto, `Resposta publicada na fila de retorno ${replyTo}`);
  }

  private declarar(canal: ConfirmChannel, fila: string): Promise<unknown> {
    let filas = this.declaracoes.get(canal);
    if (!filas) {
      filas = new Map();
      this.declaracoes.set(canal, filas);
    }
    const existente = filas.get(fila);
    if (existente) {
      return existente;
    }
    const declaracao = canal.assertQueue(fila, DECLARACAO_FILA_DURAVEL);
    filas.set(fila, declaracao);
    const registro = filas;
    void declaracao.catch(() => {
      registro.delete(fila);
    });
    return declaracao;
  }
}

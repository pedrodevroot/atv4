import { EventEmitter } from 'node:events';
import type {
  ChannelModel,
  ConfirmChannel,
  ConsumeMessage,
  MessageProperties,
  Options,
  SocketOptions,
} from 'amqplib';
import { vi } from 'vitest';

export interface Publicacao {
  readonly fila: string;
  readonly conteudo: unknown;
  readonly bruto: Buffer;
  readonly propriedades: Options.Publish;
}

interface Assinatura {
  readonly fila: string;
  readonly ouvinte: (mensagem: ConsumeMessage | null) => void;
  readonly opcoes: Options.Consume | undefined;
}

function erroCanalFechado(): Error {
  const erro = new Error('Channel closed');
  erro.name = 'IllegalOperationError';
  return erro;
}

export class CanalFalso extends EventEmitter {
  fechado = false;
  readonly declaracoes: { fila: string; opcoes: Options.AssertQueue | undefined }[] = [];
  readonly filasApagadas: string[] = [];
  readonly publicacoes: Publicacao[] = [];
  readonly acks: ConsumeMessage[] = [];
  readonly nacks: { mensagem: ConsumeMessage; requeue: boolean }[] = [];
  readonly cancelamentos: string[] = [];
  readonly prefetches: number[] = [];
  readonly assinaturas = new Map<string, Assinatura>();
  falhaDeclaracao: Error | undefined;
  falhaConfirmacao: Error | undefined;
  falhaCancelamento: Error | undefined;
  confirmacaoTravada = false;
  aoPublicar: ((publicacao: Publicacao) => void) | undefined;
  private etiquetas = 0;
  private entregas = 0;
  private liberarConfirmacoes: (() => void)[] = [];

  get canal(): ConfirmChannel {
    return this as unknown as ConfirmChannel;
  }

  async assertQueue(fila: string, opcoes?: Options.AssertQueue) {
    this.garantirAberto();
    if (this.falhaDeclaracao) {
      throw this.falhaDeclaracao;
    }
    this.declaracoes.push({ fila, opcoes });
    return { queue: fila, messageCount: 0, consumerCount: 0 };
  }

  async prefetch(quantidade: number) {
    this.garantirAberto();
    this.prefetches.push(quantidade);
    return {};
  }

  async consume(
    fila: string,
    ouvinte: (mensagem: ConsumeMessage | null) => void,
    opcoes?: Options.Consume,
  ) {
    this.garantirAberto();
    this.etiquetas += 1;
    const consumerTag = `etiqueta-${this.etiquetas}`;
    this.assinaturas.set(consumerTag, { fila, ouvinte, opcoes });
    return { consumerTag };
  }

  async cancel(consumerTag: string) {
    if (this.falhaCancelamento) {
      throw this.falhaCancelamento;
    }
    this.garantirAberto();
    this.assinaturas.delete(consumerTag);
    this.cancelamentos.push(consumerTag);
    return { consumerTag };
  }

  async deleteQueue(fila: string) {
    this.garantirAberto();
    this.filasApagadas.push(fila);
    return { messageCount: 0 };
  }

  sendToQueue(fila: string, bruto: Buffer, propriedades: Options.Publish = {}): boolean {
    this.garantirAberto();
    const publicacao: Publicacao = {
      fila,
      bruto,
      conteudo: JSON.parse(bruto.toString('utf8')) as unknown,
      propriedades,
    };
    this.publicacoes.push(publicacao);
    this.aoPublicar?.(publicacao);
    return true;
  }

  async waitForConfirms(): Promise<void> {
    if (this.falhaConfirmacao) {
      throw this.falhaConfirmacao;
    }
    if (this.confirmacaoTravada) {
      await new Promise<void>((resolver) => {
        this.liberarConfirmacoes.push(resolver);
      });
    }
  }

  confirmarPendentes(): void {
    const pendentes = this.liberarConfirmacoes;
    this.liberarConfirmacoes = [];
    this.confirmacaoTravada = false;
    for (const liberar of pendentes) {
      liberar();
    }
  }

  ack(mensagem: ConsumeMessage): void {
    this.garantirAberto();
    this.acks.push(mensagem);
  }

  nack(mensagem: ConsumeMessage, _todas?: boolean, requeue = true): void {
    this.garantirAberto();
    this.nacks.push({ mensagem, requeue });
  }

  async close(): Promise<void> {
    this.fechar();
  }

  fechar(): void {
    if (this.fechado) {
      return;
    }
    this.fechado = true;
    this.emit('close');
  }

  filasConsumidas(): string[] {
    return [...this.assinaturas.values()].map((assinatura) => assinatura.fila);
  }

  assinaturaDa(fila: string): Assinatura {
    const assinatura = [...this.assinaturas.values()].find((item) => item.fila === fila);
    if (!assinatura) {
      throw new Error(`Ninguém consome a fila ${fila}`);
    }
    return assinatura;
  }

  entregar(
    fila: string,
    conteudo: unknown,
    propriedades: Partial<MessageProperties> = {},
    reentregue = false,
  ): ConsumeMessage {
    const assinatura = this.assinaturaDa(fila);
    this.entregas += 1;
    const mensagem = {
      content: Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(JSON.stringify(conteudo)),
      fields: {
        deliveryTag: this.entregas,
        redelivered: reentregue,
        exchange: '',
        routingKey: fila,
        consumerTag: 'etiqueta',
      },
      properties: { headers: {}, ...propriedades } as MessageProperties,
    } satisfies ConsumeMessage;
    assinatura.ouvinte(mensagem);
    return mensagem;
  }

  cancelarPeloServidor(fila: string): void {
    const assinatura = this.assinaturaDa(fila);
    for (const [etiqueta, item] of this.assinaturas) {
      if (item === assinatura) {
        this.assinaturas.delete(etiqueta);
      }
    }
    assinatura.ouvinte(null);
  }

  private garantirAberto(): void {
    if (this.fechado) {
      throw erroCanalFechado();
    }
  }
}

export class ModeloFalso extends EventEmitter {
  fechado = false;
  readonly canais: CanalFalso[] = [];
  falhaCanal: Error | undefined;

  get modelo(): ChannelModel {
    return this as unknown as ChannelModel;
  }

  get ultimoCanal(): CanalFalso {
    const canal = this.canais.at(-1);
    if (!canal) {
      throw new Error('Nenhum canal foi aberto');
    }
    return canal;
  }

  async createConfirmChannel(): Promise<ConfirmChannel> {
    if (this.falhaCanal) {
      throw this.falhaCanal;
    }
    const canal = new CanalFalso();
    this.canais.push(canal);
    return canal.canal;
  }

  async close(): Promise<void> {
    this.encerrar();
  }

  cair(erro = new Error('Connection closed: 320 (CONNECTION-FORCED)')): void {
    this.emit('error', erro);
    this.encerrar();
  }

  private encerrar(): void {
    if (this.fechado) {
      return;
    }
    this.fechado = true;
    for (const canal of this.canais) {
      canal.fechar();
    }
    this.emit('close');
  }
}

export function criarConectorFalso() {
  const modelos: ModeloFalso[] = [];
  const falhas: Error[] = [];
  const chamadas: { opcoes: Options.Connect; socket: SocketOptions }[] = [];
  let travado: Promise<void> | undefined;
  let destravar: (() => void) | undefined;

  const conectar = vi.fn(async (opcoes: Options.Connect, socket: SocketOptions) => {
    chamadas.push({ opcoes, socket });
    if (travado) {
      await travado;
    }
    const falha = falhas.shift();
    if (falha) {
      throw falha;
    }
    const modelo = new ModeloFalso();
    modelos.push(modelo);
    return modelo.modelo;
  });

  return {
    conectar,
    modelos,
    chamadas,
    falharProximas(quantidade: number, erro = new Error('connect ECONNREFUSED')) {
      for (let indice = 0; indice < quantidade; indice += 1) {
        falhas.push(erro);
      }
    },
    travar() {
      travado = new Promise<void>((resolver) => {
        destravar = resolver;
      });
    },
    destravar() {
      travado = undefined;
      destravar?.();
    },
    get ultimoModelo(): ModeloFalso {
      const modelo = modelos.at(-1);
      if (!modelo) {
        throw new Error('Nenhuma conexão foi aberta');
      }
      return modelo;
    },
  };
}

export function criarLoggerFalso() {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const mensagens = (nivel: keyof typeof logger): string[] =>
    logger[nivel].mock.calls.map((chamada: unknown[]) => String(chamada[1]));
  return { logger, mensagens };
}

export async function liberarTarefas(vezes = 10): Promise<void> {
  for (let indice = 0; indice < vezes; indice += 1) {
    await Promise.resolve();
  }
}

export const CONFIG_RABBITMQ = {
  host: 'cinebridge-mq',
  porta: 5672,
  usuario: 'guest',
  senha: 'guest',
  vhost: '/',
} as const;

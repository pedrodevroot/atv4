import {
  connect,
  type ChannelModel,
  type ConfirmChannel,
  type Options,
  type SocketOptions,
} from 'amqplib';

export interface LoggerMensageria {
  info(dados: object, mensagem: string): void;
  warn(dados: object, mensagem: string): void;
  error(dados: object, mensagem: string): void;
}

export interface ConfigConexaoRabbitMQ {
  readonly host: string;
  readonly porta: number;
  readonly usuario: string;
  readonly senha: string;
  readonly vhost: string;
  readonly heartbeatS?: number;
  readonly nomeConexao?: string;
}

export type FuncaoConectar = (
  opcoes: Options.Connect,
  opcoesSocket: SocketOptions,
) => Promise<ChannelModel>;

export type OuvinteConexao = (canal: ConfirmChannel) => Promise<void>;
export type TarefaEncerramento = () => Promise<void>;

export interface OpcoesConexaoRabbitMQ {
  readonly intervaloReconexaoMs?: number;
  readonly limiteCanalMs?: number;
  readonly tempoLimiteConexaoMs?: number;
  readonly conectar?: FuncaoConectar;
}

export const DECLARACAO_FILA_DURAVEL = { durable: true } as const satisfies Options.AssertQueue;
export const DECLARACAO_FILA_RETORNO = {
  durable: true,
  exclusive: true,
} as const satisfies Options.AssertQueue;

export const HEARTBEAT_PADRAO_S = 30;

export type CodigoErroMensageria =
  | 'RABBITMQ_INDISPONIVEL'
  | 'PUBLICACAO_NAO_CONFIRMADA'
  | 'RESPOSTA_NAO_RECEBIDA'
  | 'RESPOSTA_INVALIDA';

export class ErroMensageria extends Error {
  constructor(
    readonly codigo: CodigoErroMensageria,
    mensagem: string,
    opcoes?: { cause?: unknown },
  ) {
    super(mensagem, opcoes);
    this.name = 'ErroMensageria';
  }
}

export function descreverErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

interface Fechavel {
  close(): Promise<void>;
}

async function fecharSilenciosamente(recurso: Fechavel): Promise<void> {
  try {
    await recurso.close();
  } catch {
    return;
  }
}

interface EsperaCanal {
  resolver(canal: ConfirmChannel): void;
  rejeitar(erro: Error): void;
}

const conectarComAmqplib: FuncaoConectar = (opcoes, opcoesSocket) => connect(opcoes, opcoesSocket);

export class ConexaoRabbitMQ {
  private readonly intervaloReconexaoMs: number;
  private readonly limiteCanalMs: number;
  private readonly tempoLimiteConexaoMs: number;
  private readonly conectar: FuncaoConectar;
  private readonly ouvintes = new Set<OuvinteConexao>();
  private readonly tarefasEncerramento = new Set<TarefaEncerramento>();
  private readonly esperas = new Set<EsperaCanal>();
  private modelo: ChannelModel | undefined;
  private canalAtual: ConfirmChannel | undefined;
  private temporizador: NodeJS.Timeout | undefined;
  private inicio: Promise<void> | undefined;
  private liberarInicio: (() => void) | undefined;
  private encerramento: Promise<void> | undefined;
  private geracao = 0;
  private tentativas = 0;
  private jaConectou = false;

  constructor(
    private readonly config: ConfigConexaoRabbitMQ,
    private readonly logger: LoggerMensageria,
    opcoes: OpcoesConexaoRabbitMQ = {},
  ) {
    this.intervaloReconexaoMs = opcoes.intervaloReconexaoMs ?? 2_000;
    this.limiteCanalMs = opcoes.limiteCanalMs ?? 5_000;
    this.tempoLimiteConexaoMs = opcoes.tempoLimiteConexaoMs ?? 10_000;
    this.conectar = opcoes.conectar ?? conectarComAmqplib;
  }

  get endereco(): string {
    return `${this.config.host}:${this.config.porta}`;
  }

  get conectada(): boolean {
    return this.canalAtual !== undefined;
  }

  get canalDisponivel(): ConfirmChannel | undefined {
    return this.canalAtual;
  }

  get encerrada(): boolean {
    return this.encerramento !== undefined;
  }

  iniciar(): Promise<void> {
    if (this.encerramento) {
      return Promise.resolve();
    }
    this.inicio ??= new Promise<void>((resolver) => {
      this.liberarInicio = resolver;
      void this.tentarConectar();
    });
    return this.inicio;
  }

  canal(limiteMs = this.limiteCanalMs): Promise<ConfirmChannel> {
    if (this.canalAtual) {
      return Promise.resolve(this.canalAtual);
    }
    if (this.encerramento) {
      return Promise.reject(
        new ErroMensageria('RABBITMQ_INDISPONIVEL', 'A conexão com o RabbitMQ foi encerrada'),
      );
    }
    if (limiteMs <= 0) {
      return Promise.reject(this.erroIndisponivel(limiteMs));
    }
    return new Promise<ConfirmChannel>((resolver, rejeitar) => {
      const espera: EsperaCanal = {
        resolver: (canal) => {
          clearTimeout(temporizador);
          resolver(canal);
        },
        rejeitar: (erro) => {
          clearTimeout(temporizador);
          rejeitar(erro);
        },
      };
      const temporizador = setTimeout(() => {
        this.esperas.delete(espera);
        rejeitar(this.erroIndisponivel(limiteMs));
      }, limiteMs);
      this.esperas.add(espera);
    });
  }

  aoConectar(ouvinte: OuvinteConexao): () => void {
    this.ouvintes.add(ouvinte);
    return () => {
      this.ouvintes.delete(ouvinte);
    };
  }

  antesDeEncerrar(tarefa: TarefaEncerramento): () => void {
    this.tarefasEncerramento.add(tarefa);
    return () => {
      this.tarefasEncerramento.delete(tarefa);
    };
  }

  encerrar(): Promise<void> {
    this.encerramento ??= this.executarEncerramento();
    return this.encerramento;
  }

  private async executarEncerramento(): Promise<void> {
    clearTimeout(this.temporizador);
    this.temporizador = undefined;

    const tarefas = await Promise.allSettled(
      [...this.tarefasEncerramento].map((tarefa) => tarefa()),
    );
    for (const resultado of tarefas) {
      if (resultado.status === 'rejected') {
        this.logger.warn(
          { endereco: this.endereco, err: resultado.reason as unknown },
          'Falha ao preparar o encerramento da mensageria',
        );
      }
    }

    const erro = new ErroMensageria(
      'RABBITMQ_INDISPONIVEL',
      'A conexão com o RabbitMQ foi encerrada',
    );
    for (const espera of [...this.esperas]) {
      espera.rejeitar(erro);
    }
    this.esperas.clear();

    this.geracao += 1;
    const canal = this.canalAtual;
    const modelo = this.modelo;
    this.canalAtual = undefined;
    this.modelo = undefined;
    if (canal) {
      await fecharSilenciosamente(canal);
    }
    if (modelo) {
      await fecharSilenciosamente(modelo);
    }
    this.liberarInicio?.();
    this.logger.info({ endereco: this.endereco }, 'Conexão com o RabbitMQ encerrada');
  }

  private obsoleta(geracao: number): boolean {
    return this.encerramento !== undefined || geracao !== this.geracao;
  }

  private async tentarConectar(): Promise<void> {
    this.temporizador = undefined;
    if (this.encerramento) {
      return;
    }
    this.geracao += 1;
    const geracao = this.geracao;
    this.tentativas += 1;

    let modelo: ChannelModel;
    try {
      modelo = await this.conectar(this.opcoesConexao(), this.opcoesSocket());
    } catch (erro) {
      this.derrubar(
        geracao,
        `RabbitMQ indisponível em ${this.endereco}; nova tentativa agendada`,
        erro,
      );
      return;
    }
    if (this.obsoleta(geracao)) {
      await fecharSilenciosamente(modelo);
      return;
    }
    this.observarModelo(modelo, geracao);
    this.modelo = modelo;

    let canal: ConfirmChannel;
    try {
      canal = await modelo.createConfirmChannel();
    } catch (erro) {
      this.derrubar(
        geracao,
        'Não foi possível abrir o canal do RabbitMQ; nova tentativa agendada',
        erro,
      );
      return;
    }
    if (this.obsoleta(geracao)) {
      await fecharSilenciosamente(canal);
      return;
    }
    this.observarCanal(canal, geracao);
    await this.ativar(canal, geracao);
  }

  private async ativar(canal: ConfirmChannel, geracao: number): Promise<void> {
    this.canalAtual = canal;
    const reconexao = this.jaConectou;
    this.jaConectou = true;
    this.logger.info(
      { endereco: this.endereco, tentativas: this.tentativas, reconexao },
      `Conectado ao RabbitMQ em ${this.endereco}`,
    );
    this.tentativas = 0;

    for (const espera of [...this.esperas]) {
      espera.resolver(canal);
    }
    this.esperas.clear();

    for (const ouvinte of [...this.ouvintes]) {
      if (geracao !== this.geracao) {
        return;
      }
      try {
        await ouvinte(canal);
      } catch (erro) {
        this.logger.error(
          { endereco: this.endereco, err: erro },
          'Falha ao preparar o canal do RabbitMQ',
        );
      }
    }
    this.liberarInicio?.();
  }

  private observarModelo(modelo: ChannelModel, geracao: number): void {
    modelo.on('error', (erro: Error) => {
      this.logger.warn({ endereco: this.endereco, err: erro }, 'Erro na conexão com o RabbitMQ');
    });
    modelo.on('close', () => {
      this.derrubar(geracao, 'Conexão com o RabbitMQ perdida; reconectando');
    });
    modelo.on('blocked', (motivo: string) => {
      this.logger.warn({ endereco: this.endereco, motivo }, 'RabbitMQ bloqueou as publicações');
    });
    modelo.on('unblocked', () => {
      this.logger.info({ endereco: this.endereco }, 'RabbitMQ liberou as publicações');
    });
  }

  private observarCanal(canal: ConfirmChannel, geracao: number): void {
    canal.on('error', (erro: Error) => {
      this.logger.warn({ endereco: this.endereco, err: erro }, 'Erro no canal do RabbitMQ');
    });
    canal.on('close', () => {
      queueMicrotask(() => {
        this.derrubar(geracao, 'Canal do RabbitMQ fechado; reconectando');
      });
    });
  }

  private derrubar(geracao: number, mensagem: string, erro?: unknown): void {
    if (this.obsoleta(geracao)) {
      return;
    }
    this.geracao += 1;
    const modelo = this.modelo;
    this.modelo = undefined;
    this.canalAtual = undefined;
    this.logger.warn(
      {
        endereco: this.endereco,
        tentativa: this.tentativas,
        novaTentativaEmMs: this.intervaloReconexaoMs,
        ...(erro === undefined ? {} : { err: erro }),
      },
      mensagem,
    );
    if (modelo) {
      void fecharSilenciosamente(modelo);
    }
    this.agendarReconexao();
  }

  private agendarReconexao(): void {
    if (this.encerramento || this.temporizador) {
      return;
    }
    this.temporizador = setTimeout(() => {
      void this.tentarConectar();
    }, this.intervaloReconexaoMs);
  }

  private erroIndisponivel(limiteMs: number): ErroMensageria {
    return new ErroMensageria(
      'RABBITMQ_INDISPONIVEL',
      `RabbitMQ indisponível em ${this.endereco} (espera de ${Math.max(limiteMs, 0)} ms)`,
    );
  }

  private opcoesConexao(): Options.Connect {
    return {
      protocol: 'amqp',
      hostname: this.config.host,
      port: this.config.porta,
      username: this.config.usuario,
      password: this.config.senha,
      vhost: this.config.vhost,
      heartbeat: this.config.heartbeatS ?? HEARTBEAT_PADRAO_S,
    };
  }

  private opcoesSocket(): SocketOptions {
    return {
      timeout: this.tempoLimiteConexaoMs,
      ...(this.config.nomeConexao === undefined
        ? {}
        : { clientProperties: { connection_name: this.config.nomeConexao } }),
    };
  }
}

import type { ConfirmChannel, ConsumeMessage, MessageProperties } from 'amqplib';
import type {
  FalhaObservadorMensagem,
  MensagemRecebida,
  ObservadorMensagem,
  PropriedadesMensagem,
  SujeitoMensagens,
} from '../../application/ports/observador-mensagem.js';
import {
  DECLARACAO_FILA_DURAVEL,
  type ConexaoRabbitMQ,
  type LoggerMensageria,
} from './conexao-rabbitmq.js';

export interface OpcoesConsumidorFila<T> {
  readonly fila: string;
  readonly prefetch: number;
  readonly validar: (valor: unknown) => valor is T;
  readonly atrasoNovaTentativaMs: number;
  readonly limiteDrenagemMs?: number;
}

type Decodificacao =
  { readonly valido: true; readonly valor: unknown } | { readonly valido: false };

type Confirmacao = 'ack' | 'descartar' | 'reenfileirar';

interface ContextoMensagem {
  readonly fila: string;
  readonly messageId: string | undefined;
  readonly correlationId: string | undefined;
  readonly type: string | undefined;
  readonly reentregue: boolean;
}

function texto(valor: unknown): string | undefined {
  return typeof valor === 'string' ? valor : undefined;
}

export function lerPropriedades(mensagem: ConsumeMessage): PropriedadesMensagem {
  const bruto: Partial<Record<keyof MessageProperties, unknown>> = mensagem.properties;
  const cabecalhos = bruto.headers;
  const timestamp = bruto.timestamp;
  const expiration = bruto.expiration;
  return {
    messageId: texto(bruto.messageId),
    correlationId: texto(bruto.correlationId),
    replyTo: texto(bruto.replyTo),
    type: texto(bruto.type),
    contentType: texto(bruto.contentType),
    expiration: typeof expiration === 'number' ? String(expiration) : texto(expiration),
    timestamp: typeof timestamp === 'number' ? timestamp : undefined,
    headers:
      typeof cabecalhos === 'object' && cabecalhos !== null
        ? (cabecalhos as Readonly<Record<string, unknown>>)
        : {},
  };
}

function decodificar(conteudo: Buffer): Decodificacao {
  try {
    return { valido: true, valor: JSON.parse(conteudo.toString('utf8')) as unknown };
  } catch {
    return { valido: false };
  }
}

export class ConsumidorFila<T> implements SujeitoMensagens<T> {
  private readonly observadores: ObservadorMensagem<T>[] = [];
  private readonly emAndamento = new Set<Promise<void>>();
  private readonly esperasNovaTentativa = new Set<() => void>();
  private readonly limiteDrenagemMs: number;
  private canalConsumo: ConfirmChannel | undefined;
  private etiqueta: string | undefined;
  private cancelarOuvinte: (() => void) | undefined;
  private cancelarTarefaEncerramento: (() => void) | undefined;
  private parando = false;

  constructor(
    private readonly conexao: ConexaoRabbitMQ,
    private readonly opcoes: OpcoesConsumidorFila<T>,
    private readonly logger: LoggerMensageria,
  ) {
    this.limiteDrenagemMs = opcoes.limiteDrenagemMs ?? 10_000;
  }

  get fila(): string {
    return this.opcoes.fila;
  }

  get ativo(): boolean {
    return (
      !this.parando &&
      this.etiqueta !== undefined &&
      this.canalConsumo !== undefined &&
      this.canalConsumo === this.conexao.canalDisponivel
    );
  }

  get nomesObservadores(): string[] {
    return this.observadores.map((observador) => observador.nome);
  }

  get mensagensEmAndamento(): number {
    return this.emAndamento.size;
  }

  adicionarObservador(observador: ObservadorMensagem<T>): void {
    if (!this.observadores.includes(observador)) {
      this.observadores.push(observador);
    }
  }

  removerObservador(observador: ObservadorMensagem<T>): void {
    const indice = this.observadores.indexOf(observador);
    if (indice >= 0) {
      this.observadores.splice(indice, 1);
    }
  }

  async notificarObservadores(
    mensagem: MensagemRecebida<T>,
  ): Promise<readonly FalhaObservadorMensagem[]> {
    const observadores = [...this.observadores];
    if (observadores.length === 0) {
      return [{ observador: 'nenhum', erro: new Error('Nenhum observador registrado na fila') }];
    }
    const falhas: FalhaObservadorMensagem[] = [];
    await Promise.allSettled(
      observadores.map(async (observador) => {
        try {
          await observador.atualizar(mensagem);
        } catch (erro) {
          falhas.push({ observador: observador.nome, erro });
        }
      }),
    );
    return falhas;
  }

  async iniciar(): Promise<void> {
    if (this.cancelarOuvinte) {
      return;
    }
    this.parando = false;
    this.cancelarOuvinte = this.conexao.aoConectar((canal) => this.assinar(canal));
    this.cancelarTarefaEncerramento = this.conexao.antesDeEncerrar(() => this.parar());
    const canal = this.conexao.canalDisponivel;
    if (canal) {
      await this.assinar(canal);
      return;
    }
    this.logger.info(
      { fila: this.fila },
      `Aguardando o RabbitMQ para consumir a fila ${this.fila}`,
    );
  }

  async parar(): Promise<void> {
    if (!this.cancelarOuvinte) {
      return;
    }
    this.parando = true;
    this.cancelarOuvinte();
    this.cancelarOuvinte = undefined;
    this.cancelarTarefaEncerramento?.();
    this.cancelarTarefaEncerramento = undefined;

    const canal = this.canalConsumo;
    const etiqueta = this.etiqueta;
    this.canalConsumo = undefined;
    this.etiqueta = undefined;
    if (canal && etiqueta) {
      try {
        await canal.cancel(etiqueta);
      } catch (erro) {
        this.logger.warn({ fila: this.fila, err: erro }, 'Não foi possível cancelar o consumo');
      }
    }
    for (const liberar of [...this.esperasNovaTentativa]) {
      liberar();
    }
    await this.drenar();
    this.logger.info({ fila: this.fila }, `Consumo da fila ${this.fila} encerrado`);
  }

  private estaParando(): boolean {
    return this.parando;
  }

  private async assinar(canal: ConfirmChannel): Promise<void> {
    if (this.parando || this.canalConsumo === canal) {
      return;
    }
    this.canalConsumo = canal;
    this.etiqueta = undefined;
    try {
      await canal.assertQueue(this.fila, DECLARACAO_FILA_DURAVEL);
      await canal.prefetch(this.opcoes.prefetch);
      const { consumerTag } = await canal.consume(
        this.fila,
        (mensagem) => {
          this.receber(canal, mensagem);
        },
        { noAck: false },
      );
      if (this.estaParando() || this.canalConsumo !== canal) {
        await canal.cancel(consumerTag).catch(() => undefined);
        return;
      }
      this.etiqueta = consumerTag;
      this.logger.info(
        { fila: this.fila, prefetch: this.opcoes.prefetch, consumerTag },
        `Consumindo a fila ${this.fila}`,
      );
    } catch (erro) {
      if (this.canalConsumo === canal) {
        this.canalConsumo = undefined;
      }
      throw erro;
    }
  }

  private receber(canal: ConfirmChannel, mensagem: ConsumeMessage | null): void {
    if (mensagem === null) {
      this.reassinarAposCancelamento(canal);
      return;
    }
    const tarefa = this.processar(canal, mensagem).finally(() => {
      this.emAndamento.delete(tarefa);
    });
    this.emAndamento.add(tarefa);
  }

  private reassinarAposCancelamento(canal: ConfirmChannel): void {
    if (this.canalConsumo === canal) {
      this.canalConsumo = undefined;
      this.etiqueta = undefined;
    }
    if (this.parando) {
      return;
    }
    this.logger.warn(
      { fila: this.fila },
      `O RabbitMQ cancelou o consumo da fila ${this.fila}; assinando de novo`,
    );
    this.assinar(canal).catch((erro: unknown) => {
      this.logger.error({ fila: this.fila, err: erro }, 'Falha ao assinar a fila de novo');
    });
  }

  private async processar(canal: ConfirmChannel, bruta: ConsumeMessage): Promise<void> {
    const propriedades = lerPropriedades(bruta);
    const contexto: ContextoMensagem = {
      fila: this.fila,
      messageId: propriedades.messageId,
      correlationId: propriedades.correlationId,
      type: propriedades.type,
      reentregue: bruta.fields.redelivered,
    };

    if (this.parando) {
      this.confirmar(canal, bruta, 'reenfileirar', contexto);
      return;
    }

    const decodificacao = decodificar(bruta.content);
    if (!decodificacao.valido) {
      this.descartarInvalida(canal, bruta, contexto, 'JSON inválido');
      return;
    }
    const valor = decodificacao.valor;
    if (!this.opcoes.validar(valor)) {
      this.descartarInvalida(canal, bruta, contexto, 'fora do contrato');
      return;
    }

    const falhas = await this.notificarObservadores({
      fila: this.fila,
      conteudo: valor,
      propriedades,
      reentregue: bruta.fields.redelivered,
    });
    if (falhas.length === 0) {
      this.confirmar(canal, bruta, 'ack', contexto);
      return;
    }

    for (const falha of falhas) {
      this.logger.error(
        { ...contexto, observador: falha.observador, err: falha.erro },
        'Observador falhou ao tratar a mensagem',
      );
    }
    await this.aguardarNovaTentativa();
    this.logger.warn(
      { ...contexto, atrasoMs: this.opcoes.atrasoNovaTentativaMs },
      'Mensagem devolvida à fila para nova tentativa',
    );
    this.confirmar(canal, bruta, 'reenfileirar', contexto);
  }

  private descartarInvalida(
    canal: ConfirmChannel,
    mensagem: ConsumeMessage,
    contexto: ContextoMensagem,
    motivo: string,
  ): void {
    this.logger.warn({ ...contexto, motivo }, 'Mensagem inválida descartada');
    this.confirmar(canal, mensagem, 'descartar', contexto);
  }

  private confirmar(
    canal: ConfirmChannel,
    mensagem: ConsumeMessage,
    confirmacao: Confirmacao,
    contexto: ContextoMensagem,
  ): void {
    try {
      if (confirmacao === 'ack') {
        canal.ack(mensagem);
      } else {
        canal.nack(mensagem, false, confirmacao === 'reenfileirar');
      }
    } catch (erro) {
      this.logger.warn(
        { ...contexto, err: erro },
        'Não foi possível confirmar a mensagem; o RabbitMQ vai reentregá-la',
      );
    }
  }

  private aguardarNovaTentativa(): Promise<void> {
    const atraso = this.opcoes.atrasoNovaTentativaMs;
    if (this.parando || atraso <= 0) {
      return Promise.resolve();
    }
    return new Promise<void>((resolver) => {
      const liberar = () => {
        clearTimeout(temporizador);
        this.esperasNovaTentativa.delete(liberar);
        resolver();
      };
      const temporizador = setTimeout(liberar, atraso);
      this.esperasNovaTentativa.add(liberar);
    });
  }

  private async drenar(): Promise<void> {
    if (this.emAndamento.size === 0) {
      return;
    }
    let temporizador: NodeJS.Timeout | undefined;
    const limite = new Promise<false>((resolver) => {
      temporizador = setTimeout(() => {
        resolver(false);
      }, this.limiteDrenagemMs);
    });
    const concluido = Promise.allSettled([...this.emAndamento]).then(() => true as const);
    const terminou = await Promise.race([concluido, limite]);
    clearTimeout(temporizador);
    if (!terminou) {
      this.logger.warn(
        { fila: this.fila, pendentes: this.emAndamento.size },
        'Encerrando com mensagens em processamento; o RabbitMQ vai reentregá-las',
      );
    }
  }
}

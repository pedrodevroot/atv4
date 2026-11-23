import { randomUUID } from 'node:crypto';
import type { ConfirmChannel, ConsumeMessage } from 'amqplib';
import {
  DECLARACAO_FILA_DURAVEL,
  DECLARACAO_FILA_RETORNO,
  ErroMensageria,
  type ConexaoRabbitMQ,
  type LoggerMensageria,
} from './conexao-rabbitmq.js';
import {
  CODIFICACAO_CONTEUDO,
  TIPO_CONTEUDO_JSON,
  aguardarConfirmacao,
  enviarParaFila,
  serializarCorpo,
  timestampAmqp,
} from './publicador-confirmado.js';

export interface OpcoesClienteRpc<TResposta> {
  readonly filaRequisicao: string;
  readonly prefixoResposta: string;
  readonly timeoutMs: number;
  readonly validarResposta: (valor: unknown) => valor is TResposta;
  readonly limiteConexaoMs?: number;
  readonly gerarId?: () => string;
  readonly agora?: () => Date;
}

export interface PropriedadesSolicitacao {
  readonly messageId?: string;
}

interface Pendente<TResposta> {
  readonly canal: ConfirmChannel;
  readonly correlationId: string;
  resolver(resposta: TResposta): void;
  falhar(erro: ErroMensageria): void;
}

interface ContextoSolicitacao {
  readonly fila: string;
  readonly filaResposta: string;
  readonly messageId: string;
  readonly correlationId: string;
  readonly type: string;
}

function decodificar(conteudo: Buffer): { valido: true; valor: unknown } | { valido: false } {
  try {
    return { valido: true, valor: JSON.parse(conteudo.toString('utf8')) as unknown };
  } catch {
    return { valido: false };
  }
}

export class ClienteRpc<TResposta> {
  private readonly pendentes = new Map<string, Pendente<TResposta>>();
  private readonly canaisObservados = new WeakSet<ConfirmChannel>();
  private readonly gerarId: () => string;
  private readonly agora: () => Date;

  constructor(
    private readonly conexao: ConexaoRabbitMQ,
    private readonly opcoes: OpcoesClienteRpc<TResposta>,
    private readonly logger: LoggerMensageria,
  ) {
    this.gerarId = opcoes.gerarId ?? randomUUID;
    this.agora = opcoes.agora ?? (() => new Date());
  }

  get solicitacoesPendentes(): number {
    return this.pendentes.size;
  }

  async solicitar(
    corpo: object,
    tipo: string,
    propriedades: PropriedadesSolicitacao = {},
  ): Promise<TResposta> {
    const correlationId = this.gerarId();
    const filaRequisicao = this.opcoes.filaRequisicao;
    const filaResposta = `${this.opcoes.prefixoResposta}${correlationId}`;
    const contexto: ContextoSolicitacao = {
      fila: filaRequisicao,
      filaResposta,
      messageId: propriedades.messageId ?? correlationId,
      correlationId,
      type: tipo,
    };

    let canal: ConfirmChannel;
    try {
      canal = await this.conexao.canal(this.opcoes.limiteConexaoMs);
    } catch (erro) {
      this.logger.warn({ ...contexto, err: erro }, 'Consulta não enviada: RabbitMQ indisponível');
      throw erro;
    }
    this.observarCanal(canal);

    const inicio = Date.now();
    const { resposta, prazo, encerrar } = this.registrar(canal, contexto);
    let etiqueta: string | undefined;
    try {
      await Promise.race([canal.assertQueue(filaRequisicao, DECLARACAO_FILA_DURAVEL), prazo]);
      await Promise.race([canal.assertQueue(filaResposta, DECLARACAO_FILA_RETORNO), prazo]);
      const assinatura = await Promise.race([
        canal.consume(
          filaResposta,
          (mensagem) => {
            this.receber(canal, correlationId, mensagem, contexto);
          },
          { noAck: false },
        ),
        prazo,
      ]);
      etiqueta = assinatura.consumerTag;
      enviarParaFila(canal, filaRequisicao, serializarCorpo(corpo), {
        persistent: true,
        contentType: TIPO_CONTEUDO_JSON,
        contentEncoding: CODIFICACAO_CONTEUDO,
        timestamp: timestampAmqp(this.agora()),
        messageId: contexto.messageId,
        type: tipo,
        correlationId,
        replyTo: filaResposta,
        expiration: String(this.opcoes.timeoutMs),
      });
      await Promise.race([aguardarConfirmacao(canal, this.opcoes.timeoutMs), prazo]);
      this.logger.info(contexto, `Consulta publicada na fila ${filaRequisicao}`);
      const valor = await Promise.race([resposta, prazo]);
      this.logger.info(
        { ...contexto, duracaoMs: Date.now() - inicio },
        `Resposta recebida na fila ${filaResposta}`,
      );
      return valor;
    } catch (erro) {
      this.registrarFalha(erro, contexto);
      throw erro;
    } finally {
      encerrar();
      await this.limpar(canal, filaResposta, etiqueta);
    }
  }

  private registrar(
    canal: ConfirmChannel,
    contexto: ContextoSolicitacao,
  ): { resposta: Promise<TResposta>; prazo: Promise<never>; encerrar: () => void } {
    let resolverResposta: (valor: TResposta) => void = () => undefined;
    let rejeitarPrazo: (erro: ErroMensageria) => void = () => undefined;
    const resposta = new Promise<TResposta>((resolver) => {
      resolverResposta = resolver;
    });
    const prazo = new Promise<never>((_resolver, rejeitar) => {
      rejeitarPrazo = rejeitar;
    });
    void prazo.catch(() => undefined);

    const temporizador = setTimeout(() => {
      rejeitarPrazo(
        new ErroMensageria(
          'RESPOSTA_NAO_RECEBIDA',
          `Sem resposta na fila ${contexto.fila} em ${this.opcoes.timeoutMs} ms; serviço indisponível`,
        ),
      );
    }, this.opcoes.timeoutMs);

    this.pendentes.set(contexto.correlationId, {
      canal,
      correlationId: contexto.correlationId,
      resolver: resolverResposta,
      falhar: rejeitarPrazo,
    });

    return {
      resposta,
      prazo,
      encerrar: () => {
        clearTimeout(temporizador);
        this.pendentes.delete(contexto.correlationId);
      },
    };
  }

  private receber(
    canal: ConfirmChannel,
    correlationId: string,
    mensagem: ConsumeMessage | null,
    contexto: ContextoSolicitacao,
  ): void {
    const pendente = this.pendentes.get(correlationId);
    if (mensagem === null) {
      pendente?.falhar(
        new ErroMensageria(
          'RABBITMQ_INDISPONIVEL',
          `A fila de retorno ${contexto.filaResposta} foi removida antes da resposta`,
        ),
      );
      return;
    }
    this.confirmar(canal, mensagem, contexto);

    const recebida: unknown = mensagem.properties.correlationId;
    if (recebida !== correlationId) {
      this.logger.warn(
        { ...contexto, correlationIdRecebido: typeof recebida === 'string' ? recebida : null },
        'Resposta com correlationId inesperado ignorada',
      );
      return;
    }
    if (!pendente) {
      return;
    }
    const decodificacao = decodificar(mensagem.content);
    if (decodificacao.valido && this.opcoes.validarResposta(decodificacao.valor)) {
      pendente.resolver(decodificacao.valor);
      return;
    }
    pendente.falhar(
      new ErroMensageria(
        'RESPOSTA_INVALIDA',
        `Resposta fora do contrato recebida na fila ${contexto.filaResposta}`,
      ),
    );
  }

  private confirmar(
    canal: ConfirmChannel,
    mensagem: ConsumeMessage,
    contexto: ContextoSolicitacao,
  ): void {
    try {
      canal.ack(mensagem);
    } catch (erro) {
      this.logger.warn({ ...contexto, err: erro }, 'Não foi possível confirmar a resposta');
    }
  }

  private observarCanal(canal: ConfirmChannel): void {
    if (this.canaisObservados.has(canal)) {
      return;
    }
    this.canaisObservados.add(canal);
    canal.on('close', () => {
      for (const pendente of [...this.pendentes.values()]) {
        if (pendente.canal === canal) {
          pendente.falhar(
            new ErroMensageria(
              'RABBITMQ_INDISPONIVEL',
              'O canal do RabbitMQ fechou antes da resposta',
            ),
          );
        }
      }
    });
  }

  private registrarFalha(erro: unknown, contexto: ContextoSolicitacao): void {
    if (erro instanceof ErroMensageria && erro.codigo === 'RESPOSTA_NAO_RECEBIDA') {
      this.logger.warn(
        { ...contexto, timeoutMs: this.opcoes.timeoutMs },
        'Consulta sem resposta dentro do prazo; serviço indisponível',
      );
      return;
    }
    this.logger.warn({ ...contexto, err: erro }, 'Consulta pela fila falhou');
  }

  private async limpar(
    canal: ConfirmChannel,
    filaResposta: string,
    etiqueta: string | undefined,
  ): Promise<void> {
    if (etiqueta !== undefined) {
      await canal.cancel(etiqueta).catch(() => undefined);
    }
    await canal.deleteQueue(filaResposta).catch(() => undefined);
  }
}

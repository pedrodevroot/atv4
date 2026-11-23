import type { AtualizacaoProjeto } from '../contratos/atualizacoes-projetos.js';
import { FILAS } from '../contratos/mensageria.js';
import type { MensagemRecebida, ObservadorMensagem } from './ports/observador-mensagem.js';
import {
  ErroAtualizacaoRecusada,
  type RepositorioCicloVida,
  type ResultadoProcessamento,
} from './ports/repositorio-projetos.js';

export interface PropriedadesEventoSaida {
  readonly messageId: string;
  readonly type: string;
  readonly correlationId?: string;
}

export interface PublicadorEventos {
  publicar(fila: string, corpo: object, propriedades: PropriedadesEventoSaida): Promise<void>;
}

export interface LoggerRegistrador {
  info(dados: object, mensagem: string): void;
  warn(dados: object, mensagem: string): void;
  error(dados: object, mensagem: string): void;
}

export class RegistradorCicloVida implements ObservadorMensagem<AtualizacaoProjeto> {
  readonly nome = 'RegistradorCicloVida';

  constructor(
    private readonly repositorio: RepositorioCicloVida,
    private readonly publicador: PublicadorEventos,
    private readonly logger: LoggerRegistrador,
  ) {}

  async atualizar(mensagem: MensagemRecebida<AtualizacaoProjeto>): Promise<void> {
    const atualizacao = mensagem.conteudo;
    const contexto = {
      fila: mensagem.fila,
      eventoOrigemId: atualizacao.id,
      projetoId: atualizacao.dados.projeto.id,
      motivo: atualizacao.tipo,
      correlacaoId: atualizacao.correlacaoId,
      reentregue: mensagem.reentregue,
    };

    let resultado: ResultadoProcessamento;
    try {
      resultado = await this.repositorio.processarAtualizacao(atualizacao);
    } catch (erro) {
      if (erro instanceof ErroAtualizacaoRecusada) {
        this.logger.error(
          { ...contexto, err: erro },
          'Atualização recusada pelo banco; mensagem descartada para não travar a fila',
        );
        return;
      }
      throw erro;
    }

    const { eventoSaida, situacao } = resultado;
    const contextoSaida = {
      ...contexto,
      status: eventoSaida.dados.projeto.status,
      eventoSaida: eventoSaida.tipo,
      eventoSaidaId: eventoSaida.id,
    };

    if (situacao === 'repetida') {
      this.logger.info(contextoSaida, 'Atualização repetida; o evento de saída já foi publicado');
      return;
    }
    if (situacao === 'pendente') {
      this.logger.warn(contextoSaida, 'Atualização repetida; republicando o evento pendente');
    }

    await this.publicador.publicar(FILAS.EVENTOS_PROJETOS, eventoSaida, {
      messageId: eventoSaida.id,
      type: eventoSaida.tipo,
      ...(eventoSaida.correlacaoId === undefined
        ? {}
        : { correlationId: eventoSaida.correlacaoId }),
    });
    await this.repositorio.marcarPublicado(atualizacao.id);
    this.logger.info(contextoSaida, 'Ciclo de vida do projeto registrado');
  }
}

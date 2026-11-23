import type { AtualizacaoProjeto } from '../../contratos/atualizacoes-projetos.js';
import type {
  EventoProjeto,
  ProjetoRegistrado,
  StatusProjeto,
  TipoEventoProjeto,
} from '../../contratos/eventos-projetos.js';

export type SituacaoAtualizacao = 'registrada' | 'pendente' | 'repetida';

export interface ResultadoProcessamento {
  readonly situacao: SituacaoAtualizacao;
  readonly eventoSaida: EventoProjeto;
}

export interface RepositorioCicloVida {
  processarAtualizacao(atualizacao: AtualizacaoProjeto): Promise<ResultadoProcessamento>;
  marcarPublicado(eventoId: string): Promise<void>;
}

export interface ResumoProjeto extends ProjetoRegistrado {
  readonly criadoEm: string;
  readonly atualizadoEm: string;
  readonly finalizadoEm?: string;
}

export interface EventoRecebido {
  readonly eventoId: string;
  readonly tipo: string;
  readonly ocorridoEm: string;
  readonly recebidoEm: string;
  readonly correlacaoId?: string;
  readonly eventoSaida: { readonly id: string; readonly tipo: TipoEventoProjeto };
  readonly publicado: boolean;
}

export interface ProjetoDetalhado extends ResumoProjeto {
  readonly eventos: readonly EventoRecebido[];
}

export interface FiltrosProjetos {
  readonly produtorId?: string;
  readonly status?: StatusProjeto;
  readonly limite: number;
}

export interface ConsultaProjetos {
  obter(id: string): Promise<ProjetoDetalhado | undefined>;
  listar(filtros: FiltrosProjetos): Promise<readonly ResumoProjeto[]>;
}

export class ErroAtualizacaoRecusada extends Error {
  constructor(mensagem: string, opcoes?: { cause?: unknown }) {
    super(mensagem, opcoes);
    this.name = 'ErroAtualizacaoRecusada';
  }
}

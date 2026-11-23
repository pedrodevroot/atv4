import type { TipoEventoApi } from '../../../src/contratos/atualizacoes-projetos.js';
import type {
  EventoProjeto,
  MetricasProjeto,
  StatusProjeto,
  TipoEventoProjeto,
} from '../../../src/contratos/eventos-projetos.js';

export const METRICAS: MetricasProjeto = {
  rodadas: 1,
  recomendacoesGeradas: 1,
  profissionaisRecomendados: 2,
  convites: { enviados: 0, aceitos: 0, recusados: 0, expirados: 0 },
  membrosRejeitados: 0,
  substituicoes: 0,
  substituicoesIndisponiveis: 0,
  reavaliacoes: 0,
  arquivos: 0,
  pagamentos: { efetuados: 0, cancelados: 0, valorTotal: 0 },
};

export interface OpcoesEvento {
  readonly id?: string;
  readonly tipo?: TipoEventoProjeto;
  readonly motivo?: TipoEventoApi;
  readonly status?: StatusProjeto;
  readonly detalhe?: Readonly<Record<string, unknown>>;
  readonly correlacaoId?: string | null;
}

export function criarEventoProjeto(opcoes: OpcoesEvento = {}): EventoProjeto {
  const correlacaoId = opcoes.correlacaoId === undefined ? 'req-1' : opcoes.correlacaoId;
  return {
    id: opcoes.id ?? 'saida-1',
    tipo: opcoes.tipo ?? 'PROJETO_ATUALIZADO',
    versao: 1,
    ocorridoEm: '2026-11-22T12:00:01.000Z',
    origem: 'cinebridge-projetos',
    ...(correlacaoId === null ? {} : { correlacaoId }),
    dados: {
      projeto: {
        id: 'projeto-1',
        titulo: 'Curta na Serra',
        produtorId: 'produtor-1',
        tipoCaptacao: 'FICCAO',
        genero: 'drama',
        duracaoMinutos: 20,
        orcamento: 80_000,
        dataInicio: '2027-02-01T00:00:00.000Z',
        dataEntrega: '2027-05-01T00:00:00.000Z',
        localizacao: { cidade: 'São José dos Campos', uf: 'SP' },
        estrategia: 'filtragem-colaborativa',
        requisitos: [{ papel: 'DIRETOR', peso: 1 }],
        status: opcoes.status ?? 'EM_ANDAMENTO',
        metricas: METRICAS,
      },
      motivo: opcoes.motivo ?? 'DETALHES_ATUALIZADOS',
      eventoOrigemId: 'origem-1',
      detalhe: opcoes.detalhe ?? {},
    },
  };
}

export const DETALHES_POR_MOTIVO = {
  RECOMENDACAO_GERADA: {
    projetoId: 'projeto-1',
    produtorId: 'produtor-1',
    profissionais: [
      { profissionalId: 'prof-1', papel: 'DIRETOR', score: 0.9 },
      { profissionalId: 'prof-2', papel: 'EDITOR', score: 0.8 },
    ],
  },
  CONVITE_ENVIADO: {
    projetoId: 'projeto-1',
    produtorId: 'produtor-1',
    papel: 'DIRETOR',
    profissionalId: 'prof-1',
    expiraEm: '2026-11-29T12:00:00.000Z',
  },
  CONVITE_ACEITO: {
    projetoId: 'projeto-1',
    produtorId: 'produtor-1',
    papel: 'DIRETOR',
    profissionalId: 'prof-1',
  },
  CONVITE_RECUSADO: {
    projetoId: 'projeto-1',
    produtorId: 'produtor-1',
    papel: 'DIRETOR',
    profissionalId: 'prof-1',
  },
  CONVITE_EXPIRADO: {
    projetoId: 'projeto-1',
    produtorId: 'produtor-1',
    papel: 'DIRETOR',
    profissionalId: 'prof-1',
  },
  SUBSTITUICAO_INDISPONIVEL: {
    projetoId: 'projeto-1',
    produtorId: 'produtor-1',
    papel: 'DIRETOR',
    motivo: 'Não há candidatos disponíveis.',
  },
  EQUIPE_FORMADA: {
    projetoId: 'projeto-1',
    produtorId: 'produtor-1',
    equipeId: 'equipe-1',
    custoTotal: 5000,
    membros: [
      { papel: 'DIRETOR', profissionalId: 'prof-1', custo: 3000 },
      { papel: 'EDITOR', profissionalId: 'prof-2', custo: 2000 },
    ],
  },
} as const;

import type {
  AtualizacaoProjeto,
  SnapshotProjeto,
  TipoEventoApi,
} from '../../src/contratos/atualizacoes-projetos.js';

export const SNAPSHOT: SnapshotProjeto = {
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
  requisitos: [
    { papel: 'DIRETOR', peso: 1 },
    { papel: 'EDITOR', peso: 0.5 },
  ],
};

export const DADOS_RECOMENDACAO = {
  projetoId: 'projeto-1',
  produtorId: 'produtor-1',
  estrategia: 'filtragem-colaborativa',
  rodada: 1,
  parcial: false,
  equipes: [{ equipeId: 'equipe-1', custoTotal: 12_000 }],
  profissionais: [
    { profissionalId: 'prof-1', papel: 'DIRETOR', score: 0.92 },
    { profissionalId: 'prof-2', papel: 'EDITOR', score: 0.81 },
  ],
};

export const DADOS_EQUIPE_FORMADA = {
  projetoId: 'projeto-1',
  produtorId: 'produtor-1',
  equipeId: 'equipe-1',
  custoTotal: 12_000,
  membros: [
    { papel: 'DIRETOR', profissionalId: 'prof-1', custo: 8_000 },
    { papel: 'EDITOR', profissionalId: 'prof-2', custo: 4_000 },
  ],
};

export interface OpcoesAtualizacao {
  readonly id?: string;
  readonly ocorridoEm?: string;
  readonly correlacaoId?: string | null;
  readonly projeto?: Partial<SnapshotProjeto>;
}

export function criarAtualizacao(
  tipo: TipoEventoApi,
  evento: Readonly<Record<string, unknown>> = { projetoId: SNAPSHOT.id },
  opcoes: OpcoesAtualizacao = {},
): AtualizacaoProjeto {
  const correlacaoId = opcoes.correlacaoId === undefined ? 'req-1' : opcoes.correlacaoId;
  return {
    id: opcoes.id ?? `evento-${tipo.toLowerCase()}`,
    tipo,
    versao: 1,
    ocorridoEm: opcoes.ocorridoEm ?? '2026-11-22T12:00:00.000Z',
    origem: 'cinebridge-api',
    ...(correlacaoId === null ? {} : { correlacaoId }),
    dados: { projeto: { ...SNAPSHOT, ...opcoes.projeto }, evento },
  };
}

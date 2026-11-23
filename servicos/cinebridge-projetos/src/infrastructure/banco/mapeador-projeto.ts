import type {
  EventoRecebido,
  ResumoProjeto,
} from '../../application/ports/repositorio-projetos.js';
import type { SnapshotProjeto } from '../../contratos/atualizacoes-projetos.js';
import {
  STATUS_PROJETO,
  TIPOS_EVENTO_PROJETO,
  type StatusProjeto,
  type TipoEventoProjeto,
} from '../../contratos/eventos-projetos.js';
import { normalizarMetricas } from '../../domain/ciclo-vida.js';
import type { RegistroProjeto } from '../../domain/registro-projeto.js';

export type DataBanco = Date | string;

export interface LinhaProjeto {
  readonly id: string;
  readonly titulo: string;
  readonly produtor_id: string;
  readonly tipo_captacao: string;
  readonly genero: string;
  readonly duracao_minutos: number;
  readonly orcamento: string | number;
  readonly data_inicio: DataBanco;
  readonly data_entrega: DataBanco;
  readonly cidade: string;
  readonly uf: string;
  readonly estrategia: string;
  readonly requisitos: unknown;
  readonly equipe_formada_id: string | null;
  readonly status: string;
  readonly metricas: unknown;
  readonly criado_em: DataBanco;
  readonly atualizado_em: DataBanco;
  readonly finalizado_em: DataBanco | null;
}

export interface LinhaEvento {
  readonly evento_id: string;
  readonly tipo: string;
  readonly ocorrido_em: DataBanco;
  readonly recebido_em: DataBanco;
  readonly correlacao_id: string | null;
  readonly evento_saida_id: string;
  readonly evento_saida_tipo: string;
  readonly publicado: boolean;
}

export const COLUNAS_PROJETO = [
  'id',
  'titulo',
  'produtor_id',
  'tipo_captacao',
  'genero',
  'duracao_minutos',
  'orcamento',
  'data_inicio',
  'data_entrega',
  'cidade',
  'uf',
  'estrategia',
  'requisitos',
  'equipe_formada_id',
  'status',
  'metricas',
  'criado_em',
  'atualizado_em',
  'finalizado_em',
] as const satisfies readonly (keyof LinhaProjeto)[];

export function paraIso(valor: DataBanco): string {
  return (valor instanceof Date ? valor : new Date(valor)).toISOString();
}

function paraStatus(valor: string): StatusProjeto {
  return (STATUS_PROJETO as readonly string[]).includes(valor)
    ? (valor as StatusProjeto)
    : 'CRIADO';
}

function paraTipoSaida(valor: string): TipoEventoProjeto {
  return (TIPOS_EVENTO_PROJETO as readonly string[]).includes(valor)
    ? (valor as TipoEventoProjeto)
    : 'PROJETO_ATUALIZADO';
}

function paraRequisitos(valor: unknown): SnapshotProjeto['requisitos'] {
  if (!Array.isArray(valor)) {
    return [];
  }
  return valor.flatMap((item: unknown) => {
    if (typeof item !== 'object' || item === null) {
      return [];
    }
    const { papel, peso } = item as { papel?: unknown; peso?: unknown };
    return typeof papel === 'string' && typeof peso === 'number' ? [{ papel, peso }] : [];
  });
}

export function deLinhaProjeto(linha: LinhaProjeto): RegistroProjeto {
  const snapshot: SnapshotProjeto = {
    id: linha.id,
    titulo: linha.titulo,
    produtorId: linha.produtor_id,
    tipoCaptacao: linha.tipo_captacao,
    genero: linha.genero,
    duracaoMinutos: linha.duracao_minutos,
    orcamento: Number(linha.orcamento),
    dataInicio: paraIso(linha.data_inicio),
    dataEntrega: paraIso(linha.data_entrega),
    localizacao: { cidade: linha.cidade, uf: linha.uf.trim() },
    estrategia: linha.estrategia,
    requisitos: paraRequisitos(linha.requisitos),
    ...(linha.equipe_formada_id === null ? {} : { equipeFormadaId: linha.equipe_formada_id }),
  };
  return {
    snapshot,
    status: paraStatus(linha.status),
    metricas: normalizarMetricas(linha.metricas),
    criadoEm: paraIso(linha.criado_em),
    atualizadoEm: paraIso(linha.atualizado_em),
    ...(linha.finalizado_em === null ? {} : { finalizadoEm: paraIso(linha.finalizado_em) }),
  };
}

export function paraResumo(registro: RegistroProjeto): ResumoProjeto {
  return {
    ...registro.snapshot,
    status: registro.status,
    metricas: registro.metricas,
    criadoEm: registro.criadoEm,
    atualizadoEm: registro.atualizadoEm,
    ...(registro.finalizadoEm === undefined ? {} : { finalizadoEm: registro.finalizadoEm }),
  };
}

export function parametrosProjeto(registro: RegistroProjeto): unknown[] {
  const { snapshot } = registro;
  return [
    snapshot.id,
    snapshot.titulo,
    snapshot.produtorId,
    snapshot.tipoCaptacao,
    snapshot.genero,
    snapshot.duracaoMinutos,
    snapshot.orcamento,
    snapshot.dataInicio,
    snapshot.dataEntrega,
    snapshot.localizacao.cidade,
    snapshot.localizacao.uf,
    snapshot.estrategia,
    JSON.stringify(snapshot.requisitos),
    snapshot.equipeFormadaId ?? null,
    registro.status,
    JSON.stringify(registro.metricas),
    registro.criadoEm,
    registro.atualizadoEm,
    registro.finalizadoEm ?? null,
  ];
}

export function deLinhaEvento(linha: LinhaEvento): EventoRecebido {
  return {
    eventoId: linha.evento_id,
    tipo: linha.tipo,
    ocorridoEm: paraIso(linha.ocorrido_em),
    recebidoEm: paraIso(linha.recebido_em),
    ...(linha.correlacao_id === null ? {} : { correlacaoId: linha.correlacao_id }),
    eventoSaida: { id: linha.evento_saida_id, tipo: paraTipoSaida(linha.evento_saida_tipo) },
    publicado: linha.publicado,
  };
}

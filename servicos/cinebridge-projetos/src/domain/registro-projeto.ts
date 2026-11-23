import type { AtualizacaoProjeto, SnapshotProjeto } from '../contratos/atualizacoes-projetos.js';
import type {
  EventoProjeto,
  MetricasProjeto,
  StatusProjeto,
} from '../contratos/eventos-projetos.js';
import { criarEnvelope } from '../contratos/mensageria.js';
import { aplicarEvento, decidirTransicao, metricasIniciais, type Transicao } from './ciclo-vida.js';

export const ORIGEM_EVENTOS = 'cinebridge-projetos';

export interface RegistroProjeto {
  readonly snapshot: SnapshotProjeto;
  readonly status: StatusProjeto;
  readonly metricas: MetricasProjeto;
  readonly criadoEm: string;
  readonly atualizadoEm: string;
  readonly finalizadoEm?: string;
}

export interface OpcoesRegistro {
  readonly idEventoSaida: string;
  readonly agora: Date;
}

export interface ResultadoRegistro {
  readonly registro: RegistroProjeto;
  readonly transicao: Transicao;
  readonly eventoSaida: EventoProjeto;
}

export function normalizarSnapshot(snapshot: SnapshotProjeto): SnapshotProjeto {
  return {
    id: snapshot.id,
    titulo: snapshot.titulo,
    produtorId: snapshot.produtorId,
    tipoCaptacao: snapshot.tipoCaptacao,
    genero: snapshot.genero,
    duracaoMinutos: snapshot.duracaoMinutos,
    orcamento: snapshot.orcamento,
    dataInicio: snapshot.dataInicio,
    dataEntrega: snapshot.dataEntrega,
    localizacao: { cidade: snapshot.localizacao.cidade, uf: snapshot.localizacao.uf },
    estrategia: snapshot.estrategia,
    requisitos: snapshot.requisitos.map((requisito) => ({
      papel: requisito.papel,
      peso: requisito.peso,
    })),
    ...(snapshot.equipeFormadaId === undefined
      ? {}
      : { equipeFormadaId: snapshot.equipeFormadaId }),
  };
}

function instante(dataHora: string): number {
  return new Date(dataHora).getTime();
}

function maisAntigo(primeiro: string, segundo: string): string {
  return instante(segundo) < instante(primeiro) ? segundo : primeiro;
}

export function snapshotEhMaisRecente(ocorridoEm: string, atualizadoEm: string): boolean {
  return instante(ocorridoEm) >= instante(atualizadoEm);
}

export function consolidarRegistro(
  existente: RegistroProjeto | undefined,
  atualizacao: AtualizacaoProjeto,
  transicao: Transicao,
): RegistroProjeto {
  const ocorridoEm = new Date(atualizacao.ocorridoEm).toISOString();
  const { projeto, evento } = atualizacao.dados;
  const finalizado = transicao.status === 'FINALIZADO';

  if (existente === undefined) {
    return {
      snapshot: normalizarSnapshot(projeto),
      status: transicao.status,
      metricas: aplicarEvento(metricasIniciais(), atualizacao.tipo, evento),
      criadoEm: ocorridoEm,
      atualizadoEm: ocorridoEm,
      ...(finalizado ? { finalizadoEm: ocorridoEm } : {}),
    };
  }

  const snapshotNovo = snapshotEhMaisRecente(ocorridoEm, existente.atualizadoEm);
  const finalizadoEm = existente.finalizadoEm ?? (finalizado ? ocorridoEm : undefined);
  return {
    snapshot: snapshotNovo ? normalizarSnapshot(projeto) : existente.snapshot,
    status: transicao.status,
    metricas: aplicarEvento(existente.metricas, atualizacao.tipo, evento),
    criadoEm: maisAntigo(existente.criadoEm, ocorridoEm),
    atualizadoEm: snapshotNovo ? ocorridoEm : existente.atualizadoEm,
    ...(finalizadoEm === undefined ? {} : { finalizadoEm }),
  };
}

export function montarEventoSaida(
  registro: RegistroProjeto,
  transicao: Transicao,
  atualizacao: AtualizacaoProjeto,
  opcoes: OpcoesRegistro,
): EventoProjeto {
  return criarEnvelope(
    transicao.tipoEventoSaida,
    {
      projeto: { ...registro.snapshot, status: registro.status, metricas: registro.metricas },
      motivo: atualizacao.tipo,
      eventoOrigemId: atualizacao.id,
      detalhe: atualizacao.dados.evento,
    },
    ORIGEM_EVENTOS,
    {
      id: opcoes.idEventoSaida,
      ocorridoEm: opcoes.agora,
      ...(atualizacao.correlacaoId === undefined ? {} : { correlacaoId: atualizacao.correlacaoId }),
    },
  );
}

export function registrarAtualizacao(
  existente: RegistroProjeto | undefined,
  atualizacao: AtualizacaoProjeto,
  opcoes: OpcoesRegistro,
): ResultadoRegistro {
  const transicao = decidirTransicao(existente?.status, atualizacao.tipo);
  const registro = consolidarRegistro(existente, atualizacao, transicao);
  const eventoSaida = montarEventoSaida(registro, transicao, atualizacao, opcoes);
  return { registro, transicao, eventoSaida };
}

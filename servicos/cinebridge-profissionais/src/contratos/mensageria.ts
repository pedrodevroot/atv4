import { randomUUID } from 'node:crypto';
import Type, { type TSchema } from 'typebox';

export const FILAS = {
  CONSULTA_PROFISSIONAIS: 'consulta-profissionais',
  ATUALIZACOES_PROJETOS: 'atualizacoes-projetos',
  EVENTOS_PROJETOS: 'eventos-projetos',
} as const;

export type NomeFila = (typeof FILAS)[keyof typeof FILAS];

export const PREFIXO_FILA_RESPOSTA = 'consulta-profissionais.resposta.';
export const OPCOES_FILA_DURAVEL = { durable: true } as const;
export const OPCOES_FILA_RESPOSTA = { durable: true, exclusive: true } as const;

export const VERSAO_CONTRATO = 1;

export const ORIGENS_MENSAGEM = [
  'cinebridge-api',
  'cinebridge-profissionais',
  'cinebridge-projetos',
] as const;

export type OrigemMensagem = (typeof ORIGENS_MENSAGEM)[number];

export interface Envelope<TTipo extends string, TDados> {
  readonly id: string;
  readonly tipo: TTipo;
  readonly versao: 1;
  readonly ocorridoEm: string;
  readonly origem: OrigemMensagem;
  readonly correlacaoId?: string;
  readonly dados: TDados;
}

export const EsquemaIdentificador = Type.String({ minLength: 1, maxLength: 64 });
export const EsquemaDataHora = Type.String({ format: 'date-time' });
export const EsquemaRegistroLivre = Type.Record(Type.String(), Type.Unknown());

export function esquemaEnvelope<TTipo extends TSchema, TDados extends TSchema>(
  tipo: TTipo,
  dados: TDados,
) {
  return Type.Object({
    id: EsquemaIdentificador,
    tipo,
    versao: Type.Literal(VERSAO_CONTRATO),
    ocorridoEm: EsquemaDataHora,
    origem: Type.Enum([...ORIGENS_MENSAGEM]),
    correlacaoId: Type.Optional(EsquemaIdentificador),
    dados,
  });
}

export interface OpcoesEnvelope {
  readonly id?: string;
  readonly ocorridoEm?: Date | string;
  readonly correlacaoId?: string;
}

export function criarEnvelope<TTipo extends string, TDados>(
  tipo: TTipo,
  dados: TDados,
  origem: OrigemMensagem,
  opcoes: OpcoesEnvelope = {},
): Envelope<TTipo, TDados> {
  const ocorridoEm = opcoes.ocorridoEm ?? new Date();
  return {
    id: opcoes.id ?? randomUUID(),
    tipo,
    versao: VERSAO_CONTRATO,
    ocorridoEm: typeof ocorridoEm === 'string' ? ocorridoEm : ocorridoEm.toISOString(),
    origem,
    ...(opcoes.correlacaoId === undefined ? {} : { correlacaoId: opcoes.correlacaoId }),
    dados,
  };
}

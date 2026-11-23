import Type from 'typebox';
import { Compile } from 'typebox/compile';
import {
  EsquemaDataHora,
  EsquemaIdentificador,
  EsquemaRegistroLivre,
  esquemaEnvelope,
  type Envelope,
} from './mensageria.js';

export const TIPOS_EVENTO_API = [
  'RECOMENDACAO_GERADA',
  'SUBSTITUICAO_SOLICITADA',
  'SUBSTITUICAO_INDISPONIVEL',
  'MEMBRO_REJEITADO',
  'CONVITE_ENVIADO',
  'CONVITE_ACEITO',
  'CONVITE_RECUSADO',
  'CONVITE_EXPIRADO',
  'REAVALIACAO_SOLICITADA',
  'DETALHES_ATUALIZADOS',
  'EQUIPE_FORMADA',
  'ARQUIVO_ANEXADO',
  'PAGAMENTO_EFETUADO',
  'PAGAMENTO_CANCELADO',
] as const;

export type TipoEventoApi = (typeof TIPOS_EVENTO_API)[number];

export interface SnapshotProjeto {
  readonly id: string;
  readonly titulo: string;
  readonly produtorId: string;
  readonly tipoCaptacao: string;
  readonly genero: string;
  readonly duracaoMinutos: number;
  readonly orcamento: number;
  readonly dataInicio: string;
  readonly dataEntrega: string;
  readonly localizacao: { readonly cidade: string; readonly uf: string };
  readonly estrategia: string;
  readonly requisitos: readonly { readonly papel: string; readonly peso: number }[];
  readonly equipeFormadaId?: string;
}

export interface DadosAtualizacaoProjeto {
  readonly projeto: SnapshotProjeto;
  readonly evento: Readonly<Record<string, unknown>>;
}

export type AtualizacaoProjeto = Envelope<TipoEventoApi, DadosAtualizacaoProjeto>;

export const EsquemaTipoEventoApi = Type.Enum([...TIPOS_EVENTO_API]);

export const EsquemaSnapshotProjeto = Type.Object({
  id: EsquemaIdentificador,
  titulo: Type.String({ minLength: 1 }),
  produtorId: EsquemaIdentificador,
  tipoCaptacao: Type.String({ minLength: 1 }),
  genero: Type.String(),
  duracaoMinutos: Type.Integer({ minimum: 0 }),
  orcamento: Type.Number({ minimum: 0 }),
  dataInicio: EsquemaDataHora,
  dataEntrega: EsquemaDataHora,
  localizacao: Type.Object({
    cidade: Type.String(),
    uf: Type.String({ minLength: 2, maxLength: 2 }),
  }),
  estrategia: Type.String({ minLength: 1 }),
  requisitos: Type.Array(
    Type.Object({ papel: Type.String({ minLength: 1 }), peso: Type.Number() }),
  ),
  equipeFormadaId: Type.Optional(EsquemaIdentificador),
});

export const EsquemaAtualizacaoProjeto = esquemaEnvelope(
  EsquemaTipoEventoApi,
  Type.Object({ projeto: EsquemaSnapshotProjeto, evento: EsquemaRegistroLivre }),
);

const validadorAtualizacao = Compile(EsquemaAtualizacaoProjeto);

export function ehAtualizacaoProjeto(valor: unknown): valor is AtualizacaoProjeto {
  return validadorAtualizacao.Check(valor);
}

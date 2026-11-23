import Type from 'typebox';
import { Compile } from 'typebox/compile';
import {
  EsquemaSnapshotProjeto,
  EsquemaTipoEventoApi,
  type SnapshotProjeto,
  type TipoEventoApi,
} from './atualizacoes-projetos.js';
import {
  EsquemaIdentificador,
  EsquemaRegistroLivre,
  esquemaEnvelope,
  type Envelope,
} from './mensageria.js';

export const TIPOS_EVENTO_PROJETO = [
  'PROJETO_CRIADO',
  'PROJETO_ATUALIZADO',
  'PROJETO_FINALIZADO',
] as const;
export type TipoEventoProjeto = (typeof TIPOS_EVENTO_PROJETO)[number];

export const STATUS_PROJETO = ['CRIADO', 'EM_ANDAMENTO', 'FINALIZADO'] as const;
export type StatusProjeto = (typeof STATUS_PROJETO)[number];

export interface MetricasProjeto {
  readonly rodadas: number;
  readonly ultimaEstrategia?: string;
  readonly recomendacoesGeradas: number;
  readonly profissionaisRecomendados: number;
  readonly convites: {
    readonly enviados: number;
    readonly aceitos: number;
    readonly recusados: number;
    readonly expirados: number;
  };
  readonly membrosRejeitados: number;
  readonly substituicoes: number;
  readonly substituicoesIndisponiveis: number;
  readonly reavaliacoes: number;
  readonly arquivos: number;
  readonly pagamentos: {
    readonly efetuados: number;
    readonly cancelados: number;
    readonly valorTotal: number;
  };
  readonly equipeFormada?: {
    readonly equipeId: string;
    readonly custoTotal: number;
    readonly membros: readonly {
      readonly papel: string;
      readonly profissionalId: string;
      readonly custo: number;
    }[];
  };
}

export type ProjetoRegistrado = SnapshotProjeto & {
  readonly status: StatusProjeto;
  readonly metricas: MetricasProjeto;
};

export interface DadosEventoProjeto {
  readonly projeto: ProjetoRegistrado;
  readonly motivo: TipoEventoApi;
  readonly eventoOrigemId: string;
  readonly detalhe: Readonly<Record<string, unknown>>;
}

export type EventoProjeto = Envelope<TipoEventoProjeto, DadosEventoProjeto>;

const Contador = Type.Integer({ minimum: 0 });

export const EsquemaMetricasProjeto = Type.Object({
  rodadas: Contador,
  ultimaEstrategia: Type.Optional(Type.String()),
  recomendacoesGeradas: Contador,
  profissionaisRecomendados: Contador,
  convites: Type.Object({
    enviados: Contador,
    aceitos: Contador,
    recusados: Contador,
    expirados: Contador,
  }),
  membrosRejeitados: Contador,
  substituicoes: Contador,
  substituicoesIndisponiveis: Contador,
  reavaliacoes: Contador,
  arquivos: Contador,
  pagamentos: Type.Object({
    efetuados: Contador,
    cancelados: Contador,
    valorTotal: Type.Number(),
  }),
  equipeFormada: Type.Optional(
    Type.Object({
      equipeId: EsquemaIdentificador,
      custoTotal: Type.Number(),
      membros: Type.Array(
        Type.Object({
          papel: Type.String(),
          profissionalId: EsquemaIdentificador,
          custo: Type.Number(),
        }),
      ),
    }),
  ),
});

export const EsquemaProjetoRegistrado = Type.Object({
  ...EsquemaSnapshotProjeto.properties,
  status: Type.Enum([...STATUS_PROJETO]),
  metricas: EsquemaMetricasProjeto,
});

export const EsquemaEventoProjeto = esquemaEnvelope(
  Type.Enum([...TIPOS_EVENTO_PROJETO]),
  Type.Object({
    projeto: EsquemaProjetoRegistrado,
    motivo: EsquemaTipoEventoApi,
    eventoOrigemId: EsquemaIdentificador,
    detalhe: EsquemaRegistroLivre,
  }),
);

const validadorEvento = Compile(EsquemaEventoProjeto);

export function ehEventoProjeto(valor: unknown): valor is EventoProjeto {
  return validadorEvento.Check(valor);
}

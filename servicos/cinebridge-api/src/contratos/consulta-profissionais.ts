import Type from 'typebox';
import { Compile } from 'typebox/compile';
import { EsquemaIdentificador, esquemaEnvelope, type Envelope } from './mensageria.js';

export const TIPO_CONSULTA_PROFISSIONAIS = 'CONSULTA_PROFISSIONAIS';
export const TIPO_RESPOSTA_PROFISSIONAIS = 'RESPOSTA_PROFISSIONAIS';
export const OPERACOES_CONSULTA_PROFISSIONAIS = ['listar-ativos', 'obter-por-ids'] as const;

export type Numerico = number | string;

export interface ProfissionalCompletoRow {
  id: string;
  nome: string;
  especialidades: string[];
  preco_minimo: Numerico;
  preco_maximo: Numerico;
  cidade: string;
  uf: string;
  latitude: number;
  longitude: number;
  ativo: boolean;
  nota_media: Numerico;
  total_avaliacoes: number;
  competencias: { nome: string; nivel: number }[];
  avaliacoes: {
    id: string;
    nota: Numerico;
    comentario: string;
    data: string;
    produtor_id: string;
    projeto_id: string;
    papel: string;
    genero: string;
    tipo_captacao: string;
  }[];
  historico: {
    projeto_id: string;
    titulo: string;
    papel: string;
    genero: string;
    tipo_captacao: string;
    ano: number;
  }[];
  disponibilidades: { inicio: string; fim: string }[];
}

export type OperacaoConsultaProfissionais =
  | { readonly operacao: 'listar-ativos' }
  | { readonly operacao: 'obter-por-ids'; readonly ids: readonly string[] };

export type ConsultaProfissionais = Envelope<
  typeof TIPO_CONSULTA_PROFISSIONAIS,
  OperacaoConsultaProfissionais
>;

export interface ErroConsultaProfissionais {
  readonly codigo: string;
  readonly mensagem: string;
}

export type ResultadoConsultaProfissionais =
  | { readonly sucesso: true; readonly profissionais: readonly ProfissionalCompletoRow[] }
  | { readonly sucesso: false; readonly erro: ErroConsultaProfissionais };

export type RespostaProfissionais = Envelope<
  typeof TIPO_RESPOSTA_PROFISSIONAIS,
  ResultadoConsultaProfissionais
>;

const EsquemaNumerico = Type.Union([
  Type.Number(),
  Type.String({ pattern: '^-?[0-9]+(\\.[0-9]+)?$' }),
]);
const EsquemaTexto = Type.String();

export const EsquemaProfissionalCompleto = Type.Object({
  id: EsquemaIdentificador,
  nome: EsquemaTexto,
  especialidades: Type.Array(EsquemaTexto),
  preco_minimo: EsquemaNumerico,
  preco_maximo: EsquemaNumerico,
  cidade: EsquemaTexto,
  uf: EsquemaTexto,
  latitude: Type.Number(),
  longitude: Type.Number(),
  ativo: Type.Boolean(),
  nota_media: EsquemaNumerico,
  total_avaliacoes: Type.Integer({ minimum: 0 }),
  competencias: Type.Array(Type.Object({ nome: EsquemaTexto, nivel: Type.Integer() })),
  avaliacoes: Type.Array(
    Type.Object({
      id: EsquemaTexto,
      nota: EsquemaNumerico,
      comentario: EsquemaTexto,
      data: EsquemaTexto,
      produtor_id: EsquemaTexto,
      projeto_id: EsquemaTexto,
      papel: EsquemaTexto,
      genero: EsquemaTexto,
      tipo_captacao: EsquemaTexto,
    }),
  ),
  historico: Type.Array(
    Type.Object({
      projeto_id: EsquemaTexto,
      titulo: EsquemaTexto,
      papel: EsquemaTexto,
      genero: EsquemaTexto,
      tipo_captacao: EsquemaTexto,
      ano: Type.Integer(),
    }),
  ),
  disponibilidades: Type.Array(Type.Object({ inicio: EsquemaTexto, fim: EsquemaTexto })),
});

export const EsquemaOperacaoConsultaProfissionais = Type.Union([
  Type.Object({ operacao: Type.Literal('listar-ativos') }),
  Type.Object({
    operacao: Type.Literal('obter-por-ids'),
    ids: Type.Array(EsquemaIdentificador),
  }),
]);

export const EsquemaConsultaProfissionais = esquemaEnvelope(
  Type.Literal(TIPO_CONSULTA_PROFISSIONAIS),
  EsquemaOperacaoConsultaProfissionais,
);

export const EsquemaResultadoConsultaProfissionais = Type.Union([
  Type.Object({
    sucesso: Type.Literal(true),
    profissionais: Type.Array(EsquemaProfissionalCompleto),
  }),
  Type.Object({
    sucesso: Type.Literal(false),
    erro: Type.Object({ codigo: Type.String({ minLength: 1 }), mensagem: EsquemaTexto }),
  }),
]);

export const EsquemaRespostaProfissionais = esquemaEnvelope(
  Type.Literal(TIPO_RESPOSTA_PROFISSIONAIS),
  EsquemaResultadoConsultaProfissionais,
);

const validadorConsulta = Compile(EsquemaConsultaProfissionais);
const validadorResposta = Compile(EsquemaRespostaProfissionais);

export function ehConsultaProfissionais(valor: unknown): valor is ConsultaProfissionais {
  return validadorConsulta.Check(valor);
}

export function ehRespostaProfissionais(valor: unknown): valor is RespostaProfissionais {
  return validadorResposta.Check(valor);
}

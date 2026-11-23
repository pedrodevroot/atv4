import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import Type from 'typebox';
import type {
  CadastroProfissionais,
  ResumoProfissional,
} from '../application/ports/cadastro-profissionais.js';
import type { ProfissionalCompletoRow } from '../contratos/consulta-profissionais.js';
import { PAPEIS } from '../domain/catalogo.js';

export const LIMITE_PADRAO = 20;
export const LIMITE_MAXIMO = 100;
export const CODIGO_NAO_ENCONTRADO = 'PROFISSIONAL_NAO_ENCONTRADO';
export const MENSAGEM_NAO_ENCONTRADO = 'Profissional não encontrado';

export interface DependenciasRotasProfissionais {
  cadastro: CadastroProfissionais;
}

const EsquemaConsulta = Type.Object({
  papel: Type.Optional(Type.Enum([...PAPEIS])),
  limite: Type.Integer({ minimum: 1, maximum: LIMITE_MAXIMO, default: LIMITE_PADRAO }),
});

const EsquemaParametros = Type.Object({ id: Type.String({ minLength: 1, maxLength: 64 }) });

const EsquemaResumo = Type.Object({
  id: Type.String(),
  nome: Type.String(),
  especialidades: Type.Array(Type.String()),
  precoMinimo: Type.Number(),
  precoMaximo: Type.Number(),
  cidade: Type.String(),
  uf: Type.String(),
  ativo: Type.Boolean(),
  notaMedia: Type.Number(),
  totalAvaliacoes: Type.Integer(),
});

const EsquemaListaProfissionais = Type.Object({
  quantidade: Type.Integer(),
  profissionais: Type.Array(EsquemaResumo),
});

const EsquemaDetalhe = Type.Object({
  id: Type.String(),
  nome: Type.String(),
  especialidades: Type.Array(Type.String()),
  precoMinimo: Type.Number(),
  precoMaximo: Type.Number(),
  cidade: Type.String(),
  uf: Type.String(),
  latitude: Type.Number(),
  longitude: Type.Number(),
  ativo: Type.Boolean(),
  notaMedia: Type.Number(),
  totalAvaliacoes: Type.Integer(),
  competencias: Type.Array(Type.Object({ nome: Type.String(), nivel: Type.Integer() })),
  avaliacoes: Type.Array(
    Type.Object({
      id: Type.String(),
      nota: Type.Number(),
      comentario: Type.String(),
      data: Type.String(),
      produtorId: Type.String(),
      projetoId: Type.String(),
      papel: Type.String(),
      genero: Type.String(),
      tipoCaptacao: Type.String(),
    }),
  ),
  historico: Type.Array(
    Type.Object({
      projetoId: Type.String(),
      titulo: Type.String(),
      papel: Type.String(),
      genero: Type.String(),
      tipoCaptacao: Type.String(),
      ano: Type.Integer(),
    }),
  ),
  disponibilidades: Type.Array(Type.Object({ inicio: Type.String(), fim: Type.String() })),
});

const EsquemaErro = Type.Object({
  erro: Type.Object({ codigo: Type.String(), mensagem: Type.String() }),
});

function resumir(linha: ResumoProfissional) {
  return {
    id: linha.id,
    nome: linha.nome,
    especialidades: [...linha.especialidades],
    precoMinimo: Number(linha.preco_minimo),
    precoMaximo: Number(linha.preco_maximo),
    cidade: linha.cidade,
    uf: linha.uf,
    ativo: linha.ativo,
    notaMedia: Number(linha.nota_media),
    totalAvaliacoes: linha.total_avaliacoes,
  };
}

function detalhar(linha: ProfissionalCompletoRow) {
  return {
    id: linha.id,
    nome: linha.nome,
    especialidades: linha.especialidades,
    precoMinimo: Number(linha.preco_minimo),
    precoMaximo: Number(linha.preco_maximo),
    cidade: linha.cidade,
    uf: linha.uf,
    latitude: linha.latitude,
    longitude: linha.longitude,
    ativo: linha.ativo,
    notaMedia: Number(linha.nota_media),
    totalAvaliacoes: linha.total_avaliacoes,
    competencias: linha.competencias,
    avaliacoes: linha.avaliacoes.map((avaliacao) => ({
      id: avaliacao.id,
      nota: Number(avaliacao.nota),
      comentario: avaliacao.comentario,
      data: avaliacao.data,
      produtorId: avaliacao.produtor_id,
      projetoId: avaliacao.projeto_id,
      papel: avaliacao.papel,
      genero: avaliacao.genero,
      tipoCaptacao: avaliacao.tipo_captacao,
    })),
    historico: linha.historico.map((participacao) => ({
      projetoId: participacao.projeto_id,
      titulo: participacao.titulo,
      papel: participacao.papel,
      genero: participacao.genero,
      tipoCaptacao: participacao.tipo_captacao,
      ano: participacao.ano,
    })),
    disponibilidades: linha.disponibilidades,
  };
}

export function registrarRotasProfissionais(
  app: FastifyInstance,
  dependencias: DependenciasRotasProfissionais,
): void {
  const rotas = app.withTypeProvider<TypeBoxTypeProvider>();

  rotas.get(
    '/profissionais',
    { schema: { querystring: EsquemaConsulta, response: { 200: EsquemaListaProfissionais } } },
    async (requisicao) => {
      const { papel, limite } = requisicao.query;
      const linhas = await dependencias.cadastro.listarResumo(papel, limite);
      return { quantidade: linhas.length, profissionais: linhas.map(resumir) };
    },
  );

  rotas.get(
    '/profissionais/:id',
    {
      schema: {
        params: EsquemaParametros,
        response: { 200: EsquemaDetalhe, 404: EsquemaErro },
      },
    },
    async (requisicao, resposta) => {
      const linha = await dependencias.cadastro.obterPorId(requisicao.params.id);
      if (linha === undefined) {
        return resposta
          .code(404)
          .send({ erro: { codigo: CODIGO_NAO_ENCONTRADO, mensagem: MENSAGEM_NAO_ENCONTRADO } });
      }
      return detalhar(linha);
    },
  );
}

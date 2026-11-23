import type {
  CadastroProfissionais,
  ResumoProfissional,
} from '../../application/ports/cadastro-profissionais.js';
import type { ProfissionalCompletoRow } from '../../contratos/consulta-profissionais.js';
import type { Papel } from '../../domain/catalogo.js';
import { inserirEmBlocos, type ExecutorSql } from './insercao.js';
import type { LinhasCadastro } from './linhas-cadastro.js';

export const SELECIONAR_PROFISSIONAIS = `
SELECT p.*,
  COALESCE((SELECT json_agg(json_build_object('nome', c.nome, 'nivel', c.nivel) ORDER BY c.id)
    FROM competencia c WHERE c.profissional_id = p.id), '[]'::json) AS competencias,
  COALESCE((SELECT json_agg(json_build_object(
      'id', a.id, 'nota', a.nota, 'comentario', a.comentario, 'data', a.data,
      'produtor_id', a.produtor_id, 'projeto_id', a.projeto_id, 'papel', a.papel,
      'genero', a.genero, 'tipo_captacao', a.tipo_captacao) ORDER BY a.data, a.id)
    FROM avaliacao a WHERE a.profissional_id = p.id), '[]'::json) AS avaliacoes,
  COALESCE((SELECT json_agg(json_build_object(
      'projeto_id', h.projeto_id, 'titulo', h.titulo, 'papel', h.papel, 'genero', h.genero,
      'tipo_captacao', h.tipo_captacao, 'ano', h.ano) ORDER BY h.id)
    FROM participacao_projeto h WHERE h.profissional_id = p.id), '[]'::json) AS historico,
  COALESCE((SELECT json_agg(json_build_object('inicio', d.inicio, 'fim', d.fim) ORDER BY d.inicio)
    FROM disponibilidade d WHERE d.profissional_id = p.id), '[]'::json) AS disponibilidades
FROM profissional p`;

const SELECIONAR_RESUMO = `
SELECT id, nome, especialidades, preco_minimo, preco_maximo, cidade, uf, ativo, nota_media,
  total_avaliacoes
FROM profissional
WHERE ativo AND ($1::text IS NULL OR $1::text = ANY(especialidades))
ORDER BY nota_media DESC, total_avaliacoes DESC, id
LIMIT $2`;

const COLUNAS_PROFISSIONAL = [
  'id',
  'nome',
  'especialidades',
  'preco_minimo',
  'preco_maximo',
  'cidade',
  'uf',
  'latitude',
  'longitude',
  'ativo',
  'nota_media',
  'total_avaliacoes',
] as const;
const COLUNAS_COMPETENCIA = ['profissional_id', 'nome', 'nivel'] as const;
const COLUNAS_AVALIACAO = [
  'id',
  'profissional_id',
  'nota',
  'comentario',
  'data',
  'produtor_id',
  'projeto_id',
  'papel',
  'genero',
  'tipo_captacao',
] as const;
const COLUNAS_PARTICIPACAO = [
  'profissional_id',
  'projeto_id',
  'titulo',
  'papel',
  'genero',
  'tipo_captacao',
  'ano',
] as const;
const COLUNAS_DISPONIBILIDADE = ['profissional_id', 'inicio', 'fim'] as const;

type ExecutorConsulta = ExecutorSql;

export class RepositorioProfissionais implements CadastroProfissionais {
  constructor(private readonly pool: ExecutorConsulta) {}

  async listarAtivos(): Promise<readonly ProfissionalCompletoRow[]> {
    const resultado = await this.pool.query<ProfissionalCompletoRow>(
      `${SELECIONAR_PROFISSIONAIS} WHERE p.ativo ORDER BY p.id`,
    );
    return resultado.rows;
  }

  async obterPorIds(ids: readonly string[]): Promise<readonly ProfissionalCompletoRow[]> {
    if (ids.length === 0) {
      return [];
    }
    const resultado = await this.pool.query<ProfissionalCompletoRow>(
      `${SELECIONAR_PROFISSIONAIS} WHERE p.id = ANY($1::text[]) ORDER BY p.id`,
      [[...new Set(ids)]],
    );
    return resultado.rows;
  }

  async obterPorId(id: string): Promise<ProfissionalCompletoRow | undefined> {
    const resultado = await this.pool.query<ProfissionalCompletoRow>(
      `${SELECIONAR_PROFISSIONAIS} WHERE p.id = $1`,
      [id],
    );
    return resultado.rows[0];
  }

  async listarResumo(
    papel: Papel | undefined,
    limite: number,
  ): Promise<readonly ResumoProfissional[]> {
    const resultado = await this.pool.query<ResumoProfissional>(SELECIONAR_RESUMO, [
      papel ?? null,
      limite,
    ]);
    return resultado.rows;
  }

  async contar(executor: ExecutorConsulta = this.pool): Promise<number> {
    const resultado = await executor.query<{ total: string }>(
      'SELECT count(*) AS total FROM profissional',
    );
    return Number(resultado.rows[0]?.total ?? 0);
  }

  async salvarLote(
    linhas: readonly LinhasCadastro[],
    executor: ExecutorSql = this.pool,
  ): Promise<void> {
    if (linhas.length === 0) {
      return;
    }
    await inserirEmBlocos(
      executor,
      'profissional',
      COLUNAS_PROFISSIONAL,
      linhas.map(({ profissional: p }) => [
        p.id,
        p.nome,
        p.especialidades,
        p.preco_minimo,
        p.preco_maximo,
        p.cidade,
        p.uf,
        p.latitude,
        p.longitude,
        p.ativo,
        p.nota_media,
        p.total_avaliacoes,
      ]),
    );
    await inserirEmBlocos(
      executor,
      'competencia',
      COLUNAS_COMPETENCIA,
      linhas.flatMap((linha) =>
        linha.competencias.map((c) => [c.profissional_id, c.nome, c.nivel]),
      ),
    );
    await inserirEmBlocos(
      executor,
      'avaliacao',
      COLUNAS_AVALIACAO,
      linhas.flatMap((linha) =>
        linha.avaliacoes.map((a) => [
          a.id,
          a.profissional_id,
          a.nota,
          a.comentario,
          a.data,
          a.produtor_id,
          a.projeto_id,
          a.papel,
          a.genero,
          a.tipo_captacao,
        ]),
      ),
    );
    await inserirEmBlocos(
      executor,
      'participacao_projeto',
      COLUNAS_PARTICIPACAO,
      linhas.flatMap((linha) =>
        linha.historico.map((h) => [
          h.profissional_id,
          h.projeto_id,
          h.titulo,
          h.papel,
          h.genero,
          h.tipo_captacao,
          h.ano,
        ]),
      ),
    );
    await inserirEmBlocos(
      executor,
      'disponibilidade',
      COLUNAS_DISPONIBILIDADE,
      linhas.flatMap((linha) =>
        linha.disponibilidades.map((d) => [d.profissional_id, d.inicio, d.fim]),
      ),
    );
  }
}

import type { MigrationInterface, QueryRunner } from 'typeorm';

const CONGELAR_PERFIS = `
ALTER TABLE membro_equipe ADD COLUMN profissional jsonb;

UPDATE membro_equipe m
   SET profissional = to_jsonb(perfil)
  FROM (
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
    FROM profissional p
    WHERE p.id IN (SELECT DISTINCT profissional_id FROM membro_equipe)
  ) perfil
 WHERE perfil.id = m.profissional_id;

ALTER TABLE membro_equipe ALTER COLUMN profissional SET NOT NULL;
ALTER TABLE membro_equipe DROP CONSTRAINT IF EXISTS membro_equipe_profissional_id_fkey;

DROP TABLE disponibilidade, participacao_projeto, avaliacao, competencia, profissional;
`;

const RECRIAR_CADASTRO = `
CREATE TABLE profissional (
  id varchar(64) PRIMARY KEY,
  nome varchar(200) NOT NULL,
  especialidades text[] NOT NULL CHECK (cardinality(especialidades) > 0),
  preco_minimo numeric(14,2) NOT NULL CHECK (preco_minimo >= 0),
  preco_maximo numeric(14,2) NOT NULL,
  cidade varchar(120) NOT NULL,
  uf char(2) NOT NULL,
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  ativo boolean NOT NULL DEFAULT true,
  nota_media numeric(3,2) NOT NULL DEFAULT 0,
  total_avaliacoes integer NOT NULL DEFAULT 0,
  CONSTRAINT ck_profissional_faixa_preco CHECK (preco_maximo >= preco_minimo)
);
CREATE INDEX ix_profissional_especialidades ON profissional USING gin (especialidades);
CREATE INDEX ix_profissional_preco_ativos ON profissional (preco_minimo) WHERE ativo;
CREATE INDEX ix_profissional_nota ON profissional (nota_media DESC, total_avaliacoes DESC);

CREATE TABLE competencia (
  id bigserial PRIMARY KEY,
  profissional_id varchar(64) NOT NULL REFERENCES profissional (id) ON DELETE CASCADE,
  nome varchar(120) NOT NULL,
  nivel smallint NOT NULL CHECK (nivel BETWEEN 1 AND 5)
);
CREATE INDEX ix_competencia_profissional ON competencia (profissional_id);

CREATE TABLE avaliacao (
  id varchar(64) PRIMARY KEY,
  profissional_id varchar(64) NOT NULL REFERENCES profissional (id) ON DELETE CASCADE,
  nota numeric(2,1) NOT NULL CHECK (nota BETWEEN 1 AND 5),
  comentario text NOT NULL DEFAULT '',
  data timestamptz NOT NULL,
  produtor_id varchar(64) NOT NULL,
  projeto_id varchar(64) NOT NULL,
  papel varchar(32) NOT NULL,
  genero varchar(80) NOT NULL,
  tipo_captacao varchar(20) NOT NULL
);
CREATE INDEX ix_avaliacao_profissional ON avaliacao (profissional_id);

CREATE TABLE participacao_projeto (
  id bigserial PRIMARY KEY,
  profissional_id varchar(64) NOT NULL REFERENCES profissional (id) ON DELETE CASCADE,
  projeto_id varchar(64) NOT NULL,
  titulo varchar(200) NOT NULL,
  papel varchar(32) NOT NULL,
  genero varchar(80) NOT NULL,
  tipo_captacao varchar(20) NOT NULL,
  ano smallint NOT NULL
);
CREATE INDEX ix_participacao_profissional ON participacao_projeto (profissional_id);

CREATE TABLE disponibilidade (
  id bigserial PRIMARY KEY,
  profissional_id varchar(64) NOT NULL REFERENCES profissional (id) ON DELETE CASCADE,
  inicio timestamptz NOT NULL,
  fim timestamptz NOT NULL,
  CONSTRAINT ck_disponibilidade_periodo CHECK (inicio <= fim)
);
CREATE INDEX ix_disponibilidade_periodo ON disponibilidade (profissional_id, inicio, fim);

ALTER TABLE membro_equipe DROP COLUMN profissional;
`;

export class SepararCadastroProfissionais1790600000000 implements MigrationInterface {
  readonly name = 'SepararCadastroProfissionais1790600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(CONGELAR_PERFIS);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(RECRIAR_CADASTRO);
  }
}

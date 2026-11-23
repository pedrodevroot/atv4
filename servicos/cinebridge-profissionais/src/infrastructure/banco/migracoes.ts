import type { Migracao } from './migrador.js';

export const MIGRACAO_CADASTRO_PROFISSIONAIS: Migracao = {
  id: '001-cadastro-profissionais',
  sql: `
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
`,
};

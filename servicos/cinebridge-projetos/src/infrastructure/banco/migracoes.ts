import type { Migracao } from './migrador.js';

const CICLO_VIDA_PROJETOS = `
CREATE TABLE projeto (
  id varchar(64) PRIMARY KEY,
  titulo varchar(200) NOT NULL,
  produtor_id varchar(64) NOT NULL,
  tipo_captacao varchar(20) NOT NULL,
  genero varchar(80) NOT NULL,
  duracao_minutos integer NOT NULL,
  orcamento numeric(14,2) NOT NULL,
  data_inicio timestamptz NOT NULL,
  data_entrega timestamptz NOT NULL,
  cidade varchar(120) NOT NULL,
  uf char(2) NOT NULL,
  estrategia varchar(64) NOT NULL,
  requisitos jsonb NOT NULL DEFAULT '[]'::jsonb,
  equipe_formada_id varchar(64),
  status varchar(20) NOT NULL CHECK (status IN ('CRIADO', 'EM_ANDAMENTO', 'FINALIZADO')),
  metricas jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_em timestamptz NOT NULL,
  atualizado_em timestamptz NOT NULL,
  finalizado_em timestamptz
);
CREATE INDEX ix_projeto_produtor ON projeto (produtor_id);

CREATE TABLE evento_projeto (
  evento_id varchar(64) PRIMARY KEY,
  projeto_id varchar(64) NOT NULL REFERENCES projeto (id) ON DELETE CASCADE,
  tipo varchar(40) NOT NULL,
  ocorrido_em timestamptz NOT NULL,
  recebido_em timestamptz NOT NULL DEFAULT now(),
  correlacao_id varchar(64),
  dados jsonb NOT NULL,
  evento_saida jsonb NOT NULL,
  publicado boolean NOT NULL DEFAULT false
);
CREATE INDEX ix_evento_projeto_projeto ON evento_projeto (projeto_id, ocorrido_em);
CREATE INDEX ix_evento_projeto_pendente ON evento_projeto (recebido_em) WHERE NOT publicado;
`;

export const MIGRACOES_PROJETOS: readonly Migracao[] = [
  { id: '001-ciclo-vida-projetos', sql: CICLO_VIDA_PROJETOS },
];

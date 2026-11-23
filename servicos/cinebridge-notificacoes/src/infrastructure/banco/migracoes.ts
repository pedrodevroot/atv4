import type { Migracao } from './migrador.js';

export const MIGRACAO_CRIAR_NOTIFICACAO: Migracao = {
  id: '001-criar-notificacao',
  sql: `
CREATE TABLE notificacao (
  id bigserial PRIMARY KEY,
  evento_id varchar(64) NOT NULL,
  tipo_evento varchar(40) NOT NULL,
  motivo varchar(40) NOT NULL,
  projeto_id varchar(64) NOT NULL,
  destinatario_id varchar(64) NOT NULL,
  tipo_destinatario varchar(20) NOT NULL,
  canal varchar(10) NOT NULL CHECK (canal IN ('EMAIL', 'INTERNA')),
  assunto varchar(200) NOT NULL,
  corpo text NOT NULL,
  correlacao_id varchar(64),
  criada_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ux_notificacao_entrega UNIQUE (evento_id, destinatario_id, canal, assunto)
);
CREATE INDEX ix_notificacao_destinatario ON notificacao (destinatario_id, criada_em DESC);
CREATE INDEX ix_notificacao_projeto ON notificacao (projeto_id, criada_em DESC);
`,
};

export const MIGRACOES_NOTIFICACOES: readonly Migracao[] = [MIGRACAO_CRIAR_NOTIFICACAO];

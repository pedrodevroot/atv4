import type { EntitySchema } from 'typeorm';
import {
  ObjetoExternoSchema,
  PagamentoMembroSchema,
  TransacaoExternaSchema,
} from './integracoes.schema.js';
import {
  ConviteSchema,
  EquipeSchema,
  MembroEquipeSchema,
  ProjetoSchema,
  RecomendacaoSchema,
  RequisitoPapelSchema,
} from './projeto.schema.js';
import { AuditoriaSchema, MensagemInternaSchema } from './registros.schema.js';

export const entidades: EntitySchema[] = [
  ProjetoSchema,
  RequisitoPapelSchema,
  EquipeSchema,
  MembroEquipeSchema,
  RecomendacaoSchema,
  ConviteSchema,
  AuditoriaSchema,
  MensagemInternaSchema,
  ObjetoExternoSchema,
  TransacaoExternaSchema,
  PagamentoMembroSchema,
] as EntitySchema[];

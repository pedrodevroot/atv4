import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import Type from 'typebox';
import {
  LIMITE_MAXIMO,
  LIMITE_PADRAO,
  type ListarNotificacoes,
} from '../application/listar-notificacoes.js';
import { CANAIS_NOTIFICACAO, TIPOS_DESTINATARIO } from '../domain/aviso.js';

export interface DependenciasRotasNotificacoes {
  listarNotificacoes: ListarNotificacoes;
}

const EsquemaConsulta = Type.Object({
  destinatarioId: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  projetoId: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  canal: Type.Optional(Type.Enum([...CANAIS_NOTIFICACAO])),
  limite: Type.Integer({ minimum: 1, maximum: LIMITE_MAXIMO, default: LIMITE_PADRAO }),
});

const EsquemaNotificacao = Type.Object({
  id: Type.Integer(),
  eventoId: Type.String(),
  tipoEvento: Type.String(),
  motivo: Type.String(),
  projetoId: Type.String(),
  destinatarioId: Type.String(),
  tipoDestinatario: Type.Enum([...TIPOS_DESTINATARIO]),
  canal: Type.Enum([...CANAIS_NOTIFICACAO]),
  assunto: Type.String(),
  corpo: Type.String(),
  correlacaoId: Type.Union([Type.String(), Type.Null()]),
  criadaEm: Type.String(),
});

const EsquemaListaNotificacoes = Type.Object({
  quantidade: Type.Integer(),
  notificacoes: Type.Array(EsquemaNotificacao),
});

export function registrarRotasNotificacoes(
  app: FastifyInstance,
  dependencias: DependenciasRotasNotificacoes,
): void {
  const rotas = app.withTypeProvider<TypeBoxTypeProvider>();

  rotas.get(
    '/notificacoes',
    { schema: { querystring: EsquemaConsulta, response: { 200: EsquemaListaNotificacoes } } },
    async (requisicao) => {
      const { destinatarioId, projetoId, canal, limite } = requisicao.query;
      const notificacoes = await dependencias.listarNotificacoes.executar({
        ...(destinatarioId === undefined ? {} : { destinatarioId }),
        ...(projetoId === undefined ? {} : { projetoId }),
        ...(canal === undefined ? {} : { canal }),
        limite,
      });
      return { quantidade: notificacoes.length, notificacoes: [...notificacoes] };
    },
  );
}

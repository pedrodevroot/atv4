import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import Type, { type Static } from 'typebox';
import type {
  ConsultaProjetos,
  ProjetoDetalhado,
  ResumoProjeto,
} from '../application/ports/repositorio-projetos.js';
import {
  EsquemaProjetoRegistrado,
  type MetricasProjeto,
  STATUS_PROJETO,
  TIPOS_EVENTO_PROJETO,
} from '../contratos/eventos-projetos.js';
import { EsquemaDataHora, EsquemaIdentificador } from '../contratos/mensageria.js';

export const LIMITE_PADRAO_PROJETOS = 20;
export const LIMITE_MAXIMO_PROJETOS = 100;

export const RespostaErro = Type.Object({
  codigo: Type.String(),
  mensagem: Type.String(),
  detalhes: Type.Optional(Type.Array(Type.String())),
});

export const ResumoProjetoResposta = Type.Object({
  ...EsquemaProjetoRegistrado.properties,
  criadoEm: EsquemaDataHora,
  atualizadoEm: EsquemaDataHora,
  finalizadoEm: Type.Optional(EsquemaDataHora),
});

export const EventoRecebidoResposta = Type.Object({
  eventoId: Type.String(),
  tipo: Type.String(),
  ocorridoEm: EsquemaDataHora,
  recebidoEm: EsquemaDataHora,
  correlacaoId: Type.Optional(Type.String()),
  eventoSaida: Type.Object({
    id: Type.String(),
    tipo: Type.Enum([...TIPOS_EVENTO_PROJETO]),
  }),
  publicado: Type.Boolean(),
});

export const ProjetoDetalhadoResposta = Type.Object({
  ...ResumoProjetoResposta.properties,
  eventos: Type.Array(EventoRecebidoResposta),
});

export const ListaProjetosResposta = Type.Object({
  projetos: Type.Array(ResumoProjetoResposta),
});

const ParamsProjeto = Type.Object({ id: EsquemaIdentificador });

const FiltroProjetos = Type.Object({
  produtorId: Type.Optional(EsquemaIdentificador),
  status: Type.Optional(Type.Enum([...STATUS_PROJETO])),
  limite: Type.Integer({
    minimum: 1,
    maximum: LIMITE_MAXIMO_PROJETOS,
    default: LIMITE_PADRAO_PROJETOS,
  }),
});

function apresentarMetricas(
  metricas: MetricasProjeto,
): Static<typeof EsquemaProjetoRegistrado>['metricas'] {
  const { convites, pagamentos, equipeFormada, ...contadores } = metricas;
  return {
    ...contadores,
    convites: { ...convites },
    pagamentos: { ...pagamentos },
    ...(equipeFormada === undefined
      ? {}
      : {
          equipeFormada: {
            ...equipeFormada,
            membros: equipeFormada.membros.map((membro) => ({ ...membro })),
          },
        }),
  };
}

export function apresentarResumo(projeto: ResumoProjeto): Static<typeof ResumoProjetoResposta> {
  return {
    ...projeto,
    localizacao: { ...projeto.localizacao },
    requisitos: projeto.requisitos.map((requisito) => ({ ...requisito })),
    metricas: apresentarMetricas(projeto.metricas),
  };
}

export function apresentarDetalhado(
  projeto: ProjetoDetalhado,
): Static<typeof ProjetoDetalhadoResposta> {
  const { eventos, ...resumo } = projeto;
  return {
    ...apresentarResumo(resumo),
    eventos: eventos.map((evento) => ({ ...evento, eventoSaida: { ...evento.eventoSaida } })),
  };
}

export function rotasProjetos(consulta: ConsultaProjetos): FastifyPluginAsyncTypebox {
  return async (app) => {
    app.get(
      '/projetos/:id',
      {
        schema: {
          params: ParamsProjeto,
          response: { 200: ProjetoDetalhadoResposta, 404: RespostaErro },
        },
      },
      async (requisicao, resposta) => {
        const projeto = await consulta.obter(requisicao.params.id);
        if (projeto === undefined) {
          return resposta.code(404).send({
            codigo: 'PROJETO_NAO_ENCONTRADO',
            mensagem: `Projeto ${requisicao.params.id} não está registrado no cinebridge-projetos.`,
          });
        }
        return resposta.send(apresentarDetalhado(projeto));
      },
    );

    app.get(
      '/projetos',
      { schema: { querystring: FiltroProjetos, response: { 200: ListaProjetosResposta } } },
      async (requisicao) => {
        const { produtorId, status, limite } = requisicao.query;
        const projetos = await consulta.listar({
          limite,
          ...(produtorId === undefined ? {} : { produtorId }),
          ...(status === undefined ? {} : { status }),
        });
        return { projetos: projetos.map(apresentarResumo) };
      },
    );
  };
}

import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { ConsultarSaude } from '../../application/use-cases/consultar-saude.js';
import { RespostaSaude } from '../schemas/saude.schema.js';

export function rotasSaude(consultarSaude: ConsultarSaude): FastifyPluginAsyncTypebox {
  return async (app) => {
    app.get(
      '/health',
      {
        schema: {
          tags: ['saude'],
          summary: 'Verifica o estado do serviço e das dependências',
          description:
            'Responde 200 quando o PostgreSQL e o RabbitMQ estão disponíveis e 503 quando qualquer um deles está fora.',
          response: { 200: RespostaSaude, 503: RespostaSaude },
        },
      },
      async (_requisicao, resposta) => {
        const relatorio = await consultarSaude.executar();
        return resposta.code(relatorio.status === 'ok' ? 200 : 503).send(relatorio);
      },
    );
  };
}

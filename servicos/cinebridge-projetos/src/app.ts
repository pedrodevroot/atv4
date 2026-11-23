import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import Type from 'typebox';
import { rotasProjetos } from './api/rotas.js';
import { tratarErro } from './api/tratador-erros.js';
import type { ConsultarSaude } from './application/consultar-saude.js';
import type { ConsultaProjetos } from './application/ports/repositorio-projetos.js';

export interface DependenciasApi {
  consultarSaude: ConsultarSaude;
  consultaProjetos: ConsultaProjetos;
}

export interface OpcoesApp {
  logger?: FastifyBaseLogger;
}

const EstadoDependencia = Type.Union([Type.Literal('disponivel'), Type.Literal('indisponivel')]);

const RespostaSaude = Type.Object({
  status: Type.Union([Type.Literal('ok'), Type.Literal('degradado')]),
  timestamp: Type.String({ format: 'date-time' }),
  dependencias: Type.Record(Type.String(), EstadoDependencia),
});

export function construirApp(dependencias: DependenciasApi, opcoes: OpcoesApp = {}) {
  const app = Fastify({
    ...(opcoes.logger ? { loggerInstance: opcoes.logger } : { logger: false }),
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.setErrorHandler(tratarErro);

  app.get(
    '/health',
    { schema: { response: { 200: RespostaSaude, 503: RespostaSaude } } },
    async (_requisicao, resposta) => {
      const relatorio = await dependencias.consultarSaude.executar();
      return resposta.code(relatorio.status === 'ok' ? 200 : 503).send(relatorio);
    },
  );

  void app.register(rotasProjetos(dependencias.consultaProjetos));

  return app;
}

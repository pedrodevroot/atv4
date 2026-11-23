import { construirApp } from './app.js';
import { inicializarServico } from './application/inicializar-servico.js';
import { carregarArquivoEnv, carregarConfig } from './config.js';
import { criarContainer } from './container.js';
import { criarLogger } from './infrastructure/logging/logger.js';

carregarArquivoEnv();
const config = carregarConfig();
const logger = criarLogger(config);
const container = criarContainer(config, logger);
const app = construirApp(
  { consultarSaude: container.consultarSaude, cadastro: container.cadastro },
  { logger },
);

let encerrando = false;

app.addHook('onClose', async () => {
  encerrando = true;
  await container.encerrar();
});

await app.listen({ host: config.servidor.host, port: config.servidor.porta });
logger.info(`cinebridge-profissionais ouvindo na porta ${config.servidor.porta}`);

void inicializarServico(container, logger, {
  atrasoNovaTentativaMs: config.rabbitmq.reconexaoMs,
  encerrando: () => encerrando,
});

for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sinal, () => {
    logger.info({ sinal }, 'Encerrando serviço');
    void app.close().then(() => process.exit(0));
  });
}

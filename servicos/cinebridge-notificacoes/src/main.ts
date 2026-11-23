import { construirApp } from './app.js';
import { carregarArquivoEnv, carregarConfig } from './config.js';
import { criarContainer } from './container.js';
import { criarLogger } from './infrastructure/logging/logger.js';

carregarArquivoEnv();
const config = carregarConfig();
const logger = criarLogger(config);
const container = criarContainer(config, logger);
const app = construirApp(
  {
    consultarSaude: container.consultarSaude,
    listarNotificacoes: container.listarNotificacoes,
  },
  { logger },
);

let temporizadorMigracao: NodeJS.Timeout | undefined;

const migrarComNovasTentativas = async (): Promise<void> => {
  try {
    const aplicadas = await container.migrar();
    logger.info({ aplicadas }, 'Conectado ao PostgreSQL; migrações em dia');
  } catch (erro) {
    logger.warn({ err: erro }, 'PostgreSQL indisponível; nova tentativa em instantes');
    temporizadorMigracao = setTimeout(() => {
      void migrarComNovasTentativas();
    }, config.rabbitmq.reconexaoMs);
    return;
  }
  try {
    await container.consumidorEventos.iniciar();
  } catch (erro) {
    logger.error({ err: erro }, 'Falha ao iniciar o consumo de eventos-projetos');
  }
};

app.addHook('onClose', async () => {
  clearTimeout(temporizadorMigracao);
  await container.encerrar();
});

await migrarComNovasTentativas();
void container.conexaoRabbitMQ.iniciar();
await app.listen({ host: config.servidor.host, port: config.servidor.porta });
logger.info(`cinebridge-notificacoes ouvindo na porta ${config.servidor.porta}`);

for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sinal, () => {
    logger.info({ sinal }, 'Encerrando serviço');
    void app.close().then(() => process.exit(0));
  });
}

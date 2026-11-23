import cluster from 'node:cluster';
import { carregarArquivoEnv, carregarConfig } from './config/config.js';
import { aplicarMigracoes } from './infrastructure/database/aplicar-migracoes.js';
import { criarLogger } from './infrastructure/logging/opcoes-logger.js';

if (cluster.isPrimary) {
  carregarArquivoEnv();
  const config = carregarConfig();
  const logger = criarLogger(config);
  try {
    await aplicarMigracoes(config.banco, logger);
  } catch (erro) {
    logger.fatal({ err: erro }, 'Não foi possível aplicar as migrações do banco');
    process.exit(1);
  }
}

await import('./cluster.js');

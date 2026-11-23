import type { DataSource } from 'typeorm';
import type { ConfigBanco } from '../../config/config.js';
import { criarDataSource, garantirSchema } from './data-source.js';

export interface LoggerMigracoes {
  info(dados: object, mensagem: string): void;
}

export type FabricaDataSource = (banco: ConfigBanco) => DataSource;

export async function aplicarMigracoes(
  banco: ConfigBanco,
  logger: LoggerMigracoes,
  criar: FabricaDataSource = criarDataSource,
): Promise<number> {
  const dataSource = criar(banco);
  try {
    await dataSource.initialize();
    await garantirSchema(dataSource, banco.schema);
    const aplicadas = await dataSource.runMigrations({ transaction: 'each' });
    logger.info(
      { host: banco.host, banco: banco.nome, aplicadas: aplicadas.map((m) => m.name) },
      aplicadas.length === 0
        ? 'Nenhuma migração pendente'
        : `Migrações aplicadas: ${aplicadas.length}`,
    );
    return aplicadas.length;
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

import type { DataSource } from 'typeorm';
import { carregarConfig } from '../../src/config/config.js';
import { criarDataSource, garantirSchema } from '../../src/infrastructure/database/data-source.js';
import { entidades } from '../../src/infrastructure/database/schemas/index.js';

export async function prepararBanco(): Promise<DataSource> {
  const { banco } = carregarConfig();
  const dataSource = criarDataSource(banco);
  await dataSource.initialize();
  await garantirSchema(dataSource, banco.schema);
  await dataSource.runMigrations({ transaction: 'each' });
  return dataSource;
}

const DEADLOCK = '40P01';
const TENTATIVAS_LIMPEZA = 5;

function ehDeadlock(erro: unknown): boolean {
  if (typeof erro !== 'object' || erro === null) return false;
  const { code, driverError } = erro as { code?: unknown; driverError?: { code?: unknown } };
  return code === DEADLOCK || driverError?.code === DEADLOCK;
}

export async function limparTabelas(dataSource: DataSource): Promise<void> {
  const tabelas = entidades.map((schema) => schema.options.tableName ?? schema.options.name);
  const sql = `TRUNCATE ${tabelas.join(', ')} RESTART IDENTITY CASCADE`;
  for (let tentativa = 1; ; tentativa++) {
    try {
      await dataSource.query(sql);
      return;
    } catch (erro) {
      if (!ehDeadlock(erro) || tentativa >= TENTATIVAS_LIMPEZA) throw erro;
      await new Promise((resolver) => setTimeout(resolver, 50 * tentativa));
    }
  }
}

import { executarComBanco } from './executar-com-banco.js';

await executarComBanco(async (dataSource) => {
  const aplicadas = await dataSource.runMigrations({ transaction: 'each' });
  console.info(`Migrações aplicadas: ${aplicadas.length}`);
});

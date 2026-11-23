import type { DataSource } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import { carregarConfig } from '../../../src/config/config.js';
import { aplicarMigracoes } from '../../../src/infrastructure/database/aplicar-migracoes.js';

const { banco } = carregarConfig({
  NODE_ENV: 'test',
  DB_USER: 'u',
  DB_PASSWORD: 's',
  DB_NAME: 'b',
  DB_SCHEMA: 'esquema_teste',
});

function criarDataSourceFalso(opcoes: { migracoes?: string[]; falhaNaInicializacao?: boolean }) {
  const consultas: string[] = [];
  const falso = {
    isInitialized: false,
    initialize: vi.fn(async () => {
      if (opcoes.falhaNaInicializacao) {
        throw new Error('connect ECONNREFUSED');
      }
      falso.isInitialized = true;
    }),
    query: vi.fn(async (consulta: string) => {
      consultas.push(consulta);
    }),
    runMigrations: vi.fn(async () => (opcoes.migracoes ?? []).map((name) => ({ name }))),
    destroy: vi.fn(async () => {
      falso.isInitialized = false;
    }),
  };
  return { falso, consultas, dataSource: falso as unknown as DataSource };
}

describe('aplicarMigracoes', () => {
  it('cria o schema, roda as migrações pendentes e fecha a conexão', async () => {
    const { falso, consultas, dataSource } = criarDataSourceFalso({ migracoes: ['M1', 'M2'] });
    const info = vi.fn();

    const total = await aplicarMigracoes(banco, { info }, () => dataSource);

    expect(total).toBe(2);
    expect(consultas).toEqual(['CREATE SCHEMA IF NOT EXISTS "esquema_teste"']);
    expect(falso.runMigrations).toHaveBeenCalledWith({ transaction: 'each' });
    expect(falso.destroy).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ aplicadas: ['M1', 'M2'] }),
      'Migrações aplicadas: 2',
    );
  });

  it('informa quando não há migração pendente', async () => {
    const { dataSource } = criarDataSourceFalso({});
    const info = vi.fn();

    await expect(aplicarMigracoes(banco, { info }, () => dataSource)).resolves.toBe(0);

    expect(info).toHaveBeenCalledWith(expect.any(Object), 'Nenhuma migração pendente');
  });

  it('propaga a falha de conexão para o chamador decidir o que fazer', async () => {
    const { falso, dataSource } = criarDataSourceFalso({ falhaNaInicializacao: true });

    await expect(aplicarMigracoes(banco, { info: vi.fn() }, () => dataSource)).rejects.toThrow(
      'ECONNREFUSED',
    );
    expect(falso.runMigrations).not.toHaveBeenCalled();
    expect(falso.destroy).not.toHaveBeenCalled();
  });
});

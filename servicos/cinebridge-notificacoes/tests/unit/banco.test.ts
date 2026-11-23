import type { Pool, PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { aplicarMigracoes } from '../../src/infrastructure/banco/migrador.js';
import { criarPool } from '../../src/infrastructure/banco/pool.js';
import { VerificadorBanco } from '../../src/infrastructure/banco/verificador-banco.js';

function criarPoolFalso(jaAplicadas: readonly string[]) {
  const consultas: string[] = [];
  const cliente = {
    query: vi.fn((sql: string, parametros?: string[]) => {
      consultas.push(sql);
      if (sql.startsWith('SELECT 1 FROM migracoes')) {
        const id = parametros?.[0] ?? '';
        return Promise.resolve({ rowCount: jaAplicadas.includes(id) ? 1 : 0 });
      }
      if (sql === 'FALHAR') {
        return Promise.reject(new Error('sql inválido'));
      }
      return Promise.resolve({ rowCount: 0 });
    }),
    release: vi.fn(),
  };
  const pool = {
    connect: () => Promise.resolve(cliente as unknown as PoolClient),
  } as unknown as Pool;
  return { pool, cliente, consultas };
}

describe('aplicarMigracoes', () => {
  it('aplica só as migrações ainda não registradas', async () => {
    const { pool, cliente } = criarPoolFalso(['001']);

    const aplicadas = await aplicarMigracoes(pool, [
      { id: '001', sql: 'CREATE TABLE a ()' },
      { id: '002', sql: 'CREATE TABLE b ()' },
    ]);

    expect(aplicadas).toEqual(['002']);
    expect(cliente.release).toHaveBeenCalledOnce();
  });

  it('desfaz a transação e propaga o erro quando a migração falha', async () => {
    const { pool, consultas, cliente } = criarPoolFalso([]);

    await expect(aplicarMigracoes(pool, [{ id: '001', sql: 'FALHAR' }])).rejects.toThrow(
      'sql inválido',
    );

    expect(consultas).toContain('ROLLBACK');
    expect(cliente.release).toHaveBeenCalledOnce();
  });
});

describe('VerificadorBanco', () => {
  it('informa disponível quando o SELECT 1 responde', async () => {
    const verificador = new VerificadorBanco({ query: () => Promise.resolve({}) } as never);

    await expect(verificador.verificar()).resolves.toBe(true);
    expect(verificador.nome).toBe('postgres');
  });

  it('informa indisponível quando a consulta falha', async () => {
    const verificador = new VerificadorBanco({
      query: () => Promise.reject(new Error('sem banco')),
    } as never);

    await expect(verificador.verificar()).resolves.toBe(false);
  });

  it('informa indisponível quando a consulta passa do limite de tempo', async () => {
    const verificador = new VerificadorBanco(
      { query: () => new Promise(() => undefined) } as never,
      10,
    );

    await expect(verificador.verificar()).resolves.toBe(false);
  });
});

describe('criarPool', () => {
  it('cria o pool sem conectar', async () => {
    const pool = criarPool({
      host: 'localhost',
      porta: 5432,
      usuario: 'u',
      senha: 's',
      nome: 'n',
      poolMaximo: 2,
      timeoutMs: 1000,
    });

    expect(pool.totalCount).toBe(0);
    await pool.end();
  });
});

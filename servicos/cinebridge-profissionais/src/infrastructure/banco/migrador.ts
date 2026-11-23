import type { Pool } from 'pg';

export interface Migracao {
  readonly id: string;
  readonly sql: string;
}

const CRIAR_TABELA_MIGRACOES =
  'CREATE TABLE IF NOT EXISTS migracoes (id varchar(100) PRIMARY KEY, aplicada_em timestamptz NOT NULL DEFAULT now())';

export async function aplicarMigracoes(
  pool: Pool,
  migracoes: readonly Migracao[],
): Promise<readonly string[]> {
  const cliente = await pool.connect();
  const aplicadas: string[] = [];
  try {
    await cliente.query(CRIAR_TABELA_MIGRACOES);
    for (const migracao of migracoes) {
      await cliente.query('BEGIN');
      try {
        const jaAplicada = await cliente.query('SELECT 1 FROM migracoes WHERE id = $1', [
          migracao.id,
        ]);
        if (jaAplicada.rowCount === 0) {
          await cliente.query(migracao.sql);
          await cliente.query('INSERT INTO migracoes (id) VALUES ($1)', [migracao.id]);
          aplicadas.push(migracao.id);
        }
        await cliente.query('COMMIT');
      } catch (erro) {
        await cliente.query('ROLLBACK');
        throw erro;
      }
    }
    return aplicadas;
  } finally {
    cliente.release();
  }
}

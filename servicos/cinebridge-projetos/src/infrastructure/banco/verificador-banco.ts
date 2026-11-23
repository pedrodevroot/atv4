import type { Pool } from 'pg';
import type { VerificadorDependencia } from '../../application/ports/verificador-dependencia.js';

export class VerificadorBanco implements VerificadorDependencia {
  readonly nome = 'postgres';

  constructor(
    private readonly pool: Pick<Pool, 'query'>,
    private readonly limiteMs = 1_000,
  ) {}

  async verificar(): Promise<boolean> {
    let temporizador: NodeJS.Timeout | undefined;
    const limite = new Promise<never>((_, rejeitar) => {
      temporizador = setTimeout(() => {
        rejeitar(new Error('Verificação do PostgreSQL excedeu o tempo limite'));
      }, this.limiteMs);
    });
    try {
      await Promise.race([this.pool.query('SELECT 1'), limite]);
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(temporizador);
    }
  }
}

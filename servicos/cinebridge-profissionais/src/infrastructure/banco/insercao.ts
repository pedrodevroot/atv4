import type { Pool } from 'pg';

export type ExecutorSql = Pick<Pool, 'query'>;

export const TAMANHO_BLOCO_INSERCAO = 500;

export async function inserirEmBlocos(
  executor: ExecutorSql,
  tabela: string,
  colunas: readonly string[],
  linhas: readonly (readonly unknown[])[],
  tamanhoBloco = TAMANHO_BLOCO_INSERCAO,
): Promise<number> {
  let inseridas = 0;
  for (let inicio = 0; inicio < linhas.length; inicio += tamanhoBloco) {
    const bloco = linhas.slice(inicio, inicio + tamanhoBloco);
    const valores: unknown[] = [];
    const grupos = bloco.map((linha) => {
      const marcadores = linha.map((valor) => {
        valores.push(valor);
        return `$${valores.length}`;
      });
      return `(${marcadores.join(', ')})`;
    });
    await executor.query(
      `INSERT INTO ${tabela} (${colunas.join(', ')}) VALUES ${grupos.join(', ')}`,
      valores,
    );
    inseridas += bloco.length;
  }
  return inseridas;
}

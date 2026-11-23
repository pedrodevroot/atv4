import type { Pool, PoolClient } from 'pg';
import type { LoggerServico } from '../../application/ports/logger-servico.js';
import type { ConfigSeed } from '../../config.js';
import { gerarCadastro } from './gerador-cadastro.js';
import type { LinhasCadastro } from './linhas-cadastro.js';
import type { RepositorioProfissionais } from './repositorio-profissionais.js';

export const TRAVA_SEED_PROFISSIONAIS = 'cinebridge-profissionais-seed';
export const TAMANHO_LOTE_SEED = 1_000;

export type GeradorCadastro = (total: number, semente: number) => LinhasCadastro[];

export class SemeadorProfissionais {
  constructor(
    private readonly pool: Pick<Pool, 'connect'>,
    private readonly repositorio: Pick<RepositorioProfissionais, 'contar' | 'salvarLote'>,
    private readonly config: ConfigSeed,
    private readonly logger: LoggerServico,
    private readonly gerar: GeradorCadastro = gerarCadastro,
  ) {}

  async executar(): Promise<number> {
    if (!this.config.aoIniciar || this.config.profissionais <= 0) {
      this.logger.info({}, 'Seed de profissionais desativado');
      return 0;
    }
    const cliente = await this.pool.connect();
    try {
      await cliente.query('BEGIN');
      try {
        const inseridos = await this.semearSeVazio(cliente);
        await cliente.query('COMMIT');
        return inseridos;
      } catch (erro) {
        await cliente.query('ROLLBACK').catch(() => undefined);
        throw erro;
      }
    } finally {
      cliente.release();
    }
  }

  private async semearSeVazio(cliente: PoolClient): Promise<number> {
    await cliente.query('SELECT pg_advisory_xact_lock(hashtext($1))', [TRAVA_SEED_PROFISSIONAIS]);
    const existentes = await this.repositorio.contar(cliente);
    if (existentes > 0) {
      this.logger.info(
        { existentes },
        `Seed profissionais ignorado: o cadastro já tem ${existentes} registros`,
      );
      return 0;
    }
    const inicio = performance.now();
    const cadastro = this.gerar(this.config.profissionais, this.config.semente);
    for (let posicao = 0; posicao < cadastro.length; posicao += TAMANHO_LOTE_SEED) {
      await this.repositorio.salvarLote(
        cadastro.slice(posicao, posicao + TAMANHO_LOTE_SEED),
        cliente,
      );
    }
    const duracaoMs = Math.round(performance.now() - inicio);
    this.logger.info(
      { total: cadastro.length, duracaoMs, semente: this.config.semente },
      `Seed profissionais: ${cadastro.length} registros`,
    );
    return cadastro.length;
  }
}

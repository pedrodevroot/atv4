import type { Pool, PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { gerarCadastro } from '../../../../src/infrastructure/banco/gerador-cadastro.js';
import { inserirEmBlocos } from '../../../../src/infrastructure/banco/insercao.js';
import { MIGRACAO_CADASTRO_PROFISSIONAIS } from '../../../../src/infrastructure/banco/migracoes.js';
import {
  RepositorioProfissionais,
  SELECIONAR_PROFISSIONAIS,
} from '../../../../src/infrastructure/banco/repositorio-profissionais.js';
import {
  SemeadorProfissionais,
  TRAVA_SEED_PROFISSIONAIS,
} from '../../../../src/infrastructure/banco/semeador.js';
import { criarLinhaCompleta } from '../../helpers-cadastro.js';
import { criarLoggerFalso } from '../mensageria/dubles-rabbitmq.js';

interface Consulta {
  sql: string;
  parametros: unknown[] | undefined;
}

type Executor = Pick<Pool, 'query'>;

function criarExecutor(respostas: (sql: string) => unknown[] = () => []) {
  const consultas: Consulta[] = [];
  const executor = {
    query: vi.fn((sql: string, parametros?: unknown[]) => {
      consultas.push({ sql, parametros });
      const rows = respostas(sql);
      return Promise.resolve({ rows, rowCount: rows.length });
    }),
  };
  return { executor: executor as unknown as Executor, consultas };
}

describe('MIGRACAO_CADASTRO_PROFISSIONAIS', () => {
  it('cria exatamente as cinco tabelas do cadastro e nenhuma de outro serviço', () => {
    const tabelas = [...MIGRACAO_CADASTRO_PROFISSIONAIS.sql.matchAll(/CREATE TABLE (\w+)/g)].map(
      (achado) => achado[1],
    );

    expect(MIGRACAO_CADASTRO_PROFISSIONAIS.id).toBe('001-cadastro-profissionais');
    expect(tabelas).toEqual([
      'profissional',
      'competencia',
      'avaliacao',
      'participacao_projeto',
      'disponibilidade',
    ]);
  });
});

describe('inserirEmBlocos', () => {
  it('divide em blocos e numera os parâmetros a cada bloco', async () => {
    const { executor, consultas } = criarExecutor();

    const total = await inserirEmBlocos(
      executor,
      'tabela',
      ['a', 'b'],
      [
        [1, 'x'],
        [2, 'y'],
        [3, 'z'],
      ],
      2,
    );

    expect(total).toBe(3);
    expect(consultas).toEqual([
      { sql: 'INSERT INTO tabela (a, b) VALUES ($1, $2), ($3, $4)', parametros: [1, 'x', 2, 'y'] },
      { sql: 'INSERT INTO tabela (a, b) VALUES ($1, $2)', parametros: [3, 'z'] },
    ]);
  });

  it('não consulta nada quando não há linhas', async () => {
    const { executor, consultas } = criarExecutor();

    await expect(inserirEmBlocos(executor, 't', ['a'], [])).resolves.toBe(0);
    expect(consultas).toHaveLength(0);
  });
});

describe('RepositorioProfissionais', () => {
  it('listarAtivos usa a consulta agregada só com ativos', async () => {
    const linha = criarLinhaCompleta('p1');
    const { executor, consultas } = criarExecutor(() => [linha]);

    const resultado = await new RepositorioProfissionais(executor).listarAtivos();

    expect(resultado).toEqual([linha]);
    expect(consultas[0]?.sql).toContain(SELECIONAR_PROFISSIONAIS.trim());
    expect(consultas[0]?.sql).toContain('WHERE p.ativo');
  });

  it('obterPorIds remove repetidos e não consulta com lista vazia', async () => {
    const { executor, consultas } = criarExecutor(() => [criarLinhaCompleta('a')]);
    const repositorio = new RepositorioProfissionais(executor);

    await expect(repositorio.obterPorIds([])).resolves.toEqual([]);
    expect(consultas).toHaveLength(0);

    await repositorio.obterPorIds(['a', 'a', 'b']);
    expect(consultas[0]?.parametros).toEqual([['a', 'b']]);
  });

  it('obterPorId devolve o perfil ou undefined quando não existe', async () => {
    const vazio = criarExecutor();
    const cheio = criarExecutor(() => [criarLinhaCompleta('x')]);

    await expect(new RepositorioProfissionais(vazio.executor).obterPorId('x')).resolves.toBe(
      undefined,
    );
    await expect(
      new RepositorioProfissionais(cheio.executor).obterPorId('x'),
    ).resolves.toMatchObject({ id: 'x' });
  });

  it('listarResumo repassa papel (ou null) e limite', async () => {
    const { executor, consultas } = criarExecutor();
    const repositorio = new RepositorioProfissionais(executor);

    await repositorio.listarResumo('DIRETOR', 20);
    await repositorio.listarResumo(undefined, 5);

    expect(consultas[0]?.parametros).toEqual(['DIRETOR', 20]);
    expect(consultas[1]?.parametros).toEqual([null, 5]);
    expect(consultas[0]?.sql).toContain('ORDER BY nota_media DESC');
  });

  it('contar converte o total textual do count', async () => {
    const { executor } = criarExecutor(() => [{ total: '42' }]);
    const vazio = criarExecutor(() => []);

    await expect(new RepositorioProfissionais(executor).contar()).resolves.toBe(42);
    await expect(new RepositorioProfissionais(vazio.executor).contar()).resolves.toBe(0);
  });

  it('salvarLote grava as cinco tabelas, em blocos de até 500 linhas', async () => {
    const cadastro = gerarCadastro(120, 4);
    const { executor, consultas } = criarExecutor();

    await new RepositorioProfissionais(executor).salvarLote(cadastro);

    const tabelas = new Set(consultas.map((c) => /INSERT INTO (\w+)/.exec(c.sql)?.[1]));
    expect(tabelas).toEqual(
      new Set([
        'profissional',
        'competencia',
        'avaliacao',
        'participacao_projeto',
        'disponibilidade',
      ]),
    );
    const competencias = cadastro.reduce((soma, linha) => soma + linha.competencias.length, 0);
    const gravadas = consultas
      .filter((c) => c.sql.startsWith('INSERT INTO competencia'))
      .reduce((soma, c) => soma + (c.parametros?.length ?? 0) / 3, 0);
    expect(gravadas).toBe(competencias);
    expect(consultas.every((c) => (c.parametros?.length ?? 0) <= 500 * 12)).toBe(true);
  });

  it('salvarLote vazio não consulta e usa o executor informado', async () => {
    const principal = criarExecutor();
    const outro = criarExecutor();
    const repositorio = new RepositorioProfissionais(principal.executor);

    await repositorio.salvarLote([]);
    await repositorio.salvarLote(gerarCadastro(2, 1), outro.executor);

    expect(principal.consultas).toHaveLength(0);
    expect(outro.consultas.length).toBeGreaterThan(0);
  });
});

function criarPoolSemeador(existentes: number, falharEm?: string) {
  const consultas: string[] = [];
  const cliente = {
    query: vi.fn((sql: string, parametros?: unknown[]) => {
      expect(parametros === undefined || Array.isArray(parametros)).toBe(true);
      consultas.push(sql);
      if (falharEm && sql.startsWith(falharEm)) {
        return Promise.reject(new Error('falha simulada'));
      }
      if (sql.includes('count(*)')) {
        return Promise.resolve({ rows: [{ total: String(existentes) }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    }),
    release: vi.fn(),
  };
  const pool = { connect: () => Promise.resolve(cliente as unknown as PoolClient) };
  return { pool, cliente, consultas };
}

describe('SemeadorProfissionais', () => {
  const config = { aoIniciar: true, profissionais: 2_500, semente: 2026 };

  it('semeia o cadastro vazio numa única transação, com trava, e loga a quantidade', async () => {
    const { pool, cliente, consultas } = criarPoolSemeador(0);
    const { logger, mensagens } = criarLoggerFalso();
    const repositorio = new RepositorioProfissionais(cliente as unknown as Executor);
    const semeador = new SemeadorProfissionais(pool, repositorio, config, logger);

    const total = await semeador.executar();

    expect(total).toBe(2_500);
    expect(consultas[0]).toBe('BEGIN');
    expect(consultas[1]).toContain('pg_advisory_xact_lock');
    expect(cliente.query.mock.calls[1]?.[1]).toEqual([TRAVA_SEED_PROFISSIONAIS]);
    expect(consultas.at(-1)).toBe('COMMIT');
    expect(consultas.filter((sql) => sql.startsWith('INSERT INTO profissional '))).toHaveLength(5);
    expect(mensagens('info')).toContain('Seed profissionais: 2500 registros');
    expect(cliente.release).toHaveBeenCalledOnce();
  });

  it('não duplica: com o cadastro já populado não insere nada', async () => {
    const { pool, cliente, consultas } = criarPoolSemeador(10_000);
    const { logger, mensagens } = criarLoggerFalso();
    const repositorio = new RepositorioProfissionais(cliente as unknown as Executor);
    const gerar = vi.fn(gerarCadastro);

    const total = await new SemeadorProfissionais(
      pool,
      repositorio,
      config,
      logger,
      gerar,
    ).executar();

    expect(total).toBe(0);
    expect(gerar).not.toHaveBeenCalled();
    expect(consultas.some((sql) => sql.startsWith('INSERT'))).toBe(false);
    expect(consultas.at(-1)).toBe('COMMIT');
    expect(mensagens('info')[0]).toContain('Seed profissionais ignorado');
  });

  it('não conecta quando o seed está desativado ou com zero profissionais', async () => {
    const { pool, cliente } = criarPoolSemeador(0);
    const connect = vi.spyOn(pool, 'connect');
    const { logger } = criarLoggerFalso();
    const repositorio = new RepositorioProfissionais(cliente as unknown as Executor);

    await new SemeadorProfissionais(
      pool,
      repositorio,
      { ...config, aoIniciar: false },
      logger,
    ).executar();
    await new SemeadorProfissionais(
      pool,
      repositorio,
      { ...config, profissionais: 0 },
      logger,
    ).executar();

    expect(connect).not.toHaveBeenCalled();
  });

  it('desfaz a transação e propaga o erro quando uma inserção falha', async () => {
    const { pool, cliente, consultas } = criarPoolSemeador(0, 'INSERT INTO avaliacao');
    const { logger } = criarLoggerFalso();
    const repositorio = new RepositorioProfissionais(cliente as unknown as Executor);

    await expect(
      new SemeadorProfissionais(pool, repositorio, config, logger).executar(),
    ).rejects.toThrow('falha simulada');

    expect(consultas).toContain('ROLLBACK');
    expect(consultas).not.toContain('COMMIT');
    expect(cliente.release).toHaveBeenCalledOnce();
  });
});

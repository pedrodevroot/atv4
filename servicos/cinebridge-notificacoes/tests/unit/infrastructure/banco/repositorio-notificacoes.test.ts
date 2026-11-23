import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import type { NovaNotificacao } from '../../../../src/application/ports/repositorio-notificacoes.js';
import { MIGRACOES_NOTIFICACOES } from '../../../../src/infrastructure/banco/migracoes.js';
import {
  RepositorioNotificacoesPostgres,
  paraNotificacao,
  type LinhaNotificacao,
} from '../../../../src/infrastructure/banco/repositorio-notificacoes.js';

const NOVA: NovaNotificacao = {
  eventoId: 'saida-1',
  tipoEvento: 'PROJETO_CRIADO',
  motivo: 'RECOMENDACAO_GERADA',
  projetoId: 'projeto-1',
  destinatarioId: 'produtor-1',
  tipoDestinatario: 'PRODUTOR',
  canal: 'EMAIL',
  assunto: 'Projeto registrado: Curta na Serra',
  corpo: 'corpo',
  correlacaoId: 'req-1',
};

const LINHA: LinhaNotificacao = {
  id: '12',
  evento_id: 'saida-1',
  tipo_evento: 'PROJETO_CRIADO',
  motivo: 'RECOMENDACAO_GERADA',
  projeto_id: 'projeto-1',
  destinatario_id: 'produtor-1',
  tipo_destinatario: 'PRODUTOR',
  canal: 'EMAIL',
  assunto: 'Projeto registrado: Curta na Serra',
  corpo: 'corpo',
  correlacao_id: null,
  criada_em: new Date('2026-11-22T12:00:02.000Z'),
};

function criarPoolFalso(resposta: { rowCount?: number | null; rows?: LinhaNotificacao[] }) {
  const query = vi.fn(() => Promise.resolve(resposta));
  return { query, pool: { query } as unknown as Pick<Pool, 'query'> };
}

describe('migração da tabela notificacao', () => {
  it('cria a tabela com a restrição única de entrega e os índices', () => {
    const [migracao] = MIGRACOES_NOTIFICACOES;

    expect(MIGRACOES_NOTIFICACOES).toHaveLength(1);
    expect(migracao?.sql).toContain('CREATE TABLE notificacao');
    expect(migracao?.sql).toContain(
      'CONSTRAINT ux_notificacao_entrega UNIQUE (evento_id, destinatario_id, canal, assunto)',
    );
    expect(migracao?.sql).toContain("CHECK (canal IN ('EMAIL', 'INTERNA'))");
    expect(migracao?.sql).toContain('ix_notificacao_destinatario');
    expect(migracao?.sql).toContain('ix_notificacao_projeto');
  });
});

describe('RepositorioNotificacoesPostgres.registrar', () => {
  it('insere com ON CONFLICT DO NOTHING e informa que inseriu', async () => {
    const { pool, query } = criarPoolFalso({ rowCount: 1 });

    const inseriu = await new RepositorioNotificacoesPostgres(pool).registrar(NOVA);

    expect(inseriu).toBe(true);
    const [sql, parametros] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('ON CONFLICT ON CONSTRAINT ux_notificacao_entrega DO NOTHING');
    expect(sql).toContain('RETURNING id');
    expect(parametros).toEqual([
      'saida-1',
      'PROJETO_CRIADO',
      'RECOMENDACAO_GERADA',
      'projeto-1',
      'produtor-1',
      'PRODUTOR',
      'EMAIL',
      'Projeto registrado: Curta na Serra',
      'corpo',
      'req-1',
    ]);
  });

  it('informa que não inseriu quando o aviso já existia', async () => {
    const { pool } = criarPoolFalso({ rowCount: 0 });

    await expect(new RepositorioNotificacoesPostgres(pool).registrar(NOVA)).resolves.toBe(false);
  });

  it('trata rowCount nulo como não inserido e grava a correlação ausente como NULL', async () => {
    const { pool, query } = criarPoolFalso({ rowCount: null });
    const semCorrelacao: NovaNotificacao = { ...NOVA };
    delete (semCorrelacao as { correlacaoId?: string }).correlacaoId;

    const inseriu = await new RepositorioNotificacoesPostgres(pool).registrar(semCorrelacao);

    expect(inseriu).toBe(false);
    const parametros = (query.mock.calls[0] as unknown as [string, unknown[]])[1];
    expect(parametros.at(-1)).toBeNull();
  });
});

describe('RepositorioNotificacoesPostgres.listar', () => {
  it('monta o filtro com parâmetros, ordena pelas mais recentes e limita', async () => {
    const { pool, query } = criarPoolFalso({ rows: [LINHA] });

    const lista = await new RepositorioNotificacoesPostgres(pool).listar({
      destinatarioId: 'produtor-1',
      projetoId: 'projeto-1',
      canal: 'EMAIL',
      limite: 20,
    });

    const [sql, parametros] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain(
      'WHERE destinatario_id = $1 AND projeto_id = $2 AND canal = $3 ORDER BY criada_em DESC, id DESC LIMIT $4',
    );
    expect(parametros).toEqual(['produtor-1', 'projeto-1', 'EMAIL', 20]);
    expect(lista).toEqual([
      {
        id: 12,
        eventoId: 'saida-1',
        tipoEvento: 'PROJETO_CRIADO',
        motivo: 'RECOMENDACAO_GERADA',
        projetoId: 'projeto-1',
        destinatarioId: 'produtor-1',
        tipoDestinatario: 'PRODUTOR',
        canal: 'EMAIL',
        assunto: 'Projeto registrado: Curta na Serra',
        corpo: 'corpo',
        correlacaoId: null,
        criadaEm: '2026-11-22T12:00:02.000Z',
      },
    ]);
  });

  it('não usa WHERE sem filtros', async () => {
    const { pool, query } = criarPoolFalso({ rows: [] });

    await new RepositorioNotificacoesPostgres(pool).listar({ limite: 50 });

    const [sql, parametros] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).not.toContain('WHERE');
    expect(sql).toContain('LIMIT $1');
    expect(parametros).toEqual([50]);
  });
});

describe('paraNotificacao', () => {
  it('converte o id bigint (texto) em número e a data em ISO', () => {
    expect(paraNotificacao({ ...LINHA, criada_em: '2026-11-22T12:00:02Z' })).toMatchObject({
      id: 12,
      criadaEm: '2026-11-22T12:00:02.000Z',
    });
  });
});

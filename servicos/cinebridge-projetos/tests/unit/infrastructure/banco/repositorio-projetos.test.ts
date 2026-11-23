import { describe, expect, it } from 'vitest';
import { ErroAtualizacaoRecusada } from '../../../../src/application/ports/repositorio-projetos.js';
import { ehEventoProjeto } from '../../../../src/contratos/eventos-projetos.js';
import { MIGRACOES_PROJETOS } from '../../../../src/infrastructure/banco/migracoes.js';
import {
  RepositorioProjetos,
  SQL,
  ehErroDeDados,
} from '../../../../src/infrastructure/banco/repositorio-projetos.js';
import {
  DADOS_EQUIPE_FORMADA,
  DADOS_RECOMENDACAO,
  SNAPSHOT,
  criarAtualizacao,
} from '../../fixtures.js';
import { BancoFalso, ErroPg } from './banco-falso.js';

function montar() {
  const banco = new BancoFalso();
  let contador = 0;
  const repositorio = new RepositorioProjetos(banco, {
    gerarId: () => {
      contador += 1;
      return `saida-${contador}`;
    },
    agora: () => new Date('2026-11-22T12:00:05.000Z'),
  });
  return { banco, repositorio };
}

const RECOMENDACAO = criarAtualizacao('RECOMENDACAO_GERADA', DADOS_RECOMENDACAO);

describe('MIGRACOES_PROJETOS', () => {
  it('cria as tabelas projeto e evento_projeto com os índices do plano', () => {
    expect(MIGRACOES_PROJETOS.map((migracao) => migracao.id)).toEqual(['001-ciclo-vida-projetos']);
    const sql = MIGRACOES_PROJETOS[0]?.sql ?? '';
    for (const trecho of [
      'CREATE TABLE projeto',
      "CHECK (status IN ('CRIADO', 'EM_ANDAMENTO', 'FINALIZADO'))",
      'CREATE INDEX ix_projeto_produtor',
      'CREATE TABLE evento_projeto',
      'REFERENCES projeto (id) ON DELETE CASCADE',
      'CREATE INDEX ix_evento_projeto_projeto',
      'WHERE NOT publicado',
    ]) {
      expect(sql).toContain(trecho);
    }
  });
});

describe('RepositorioProjetos.processarAtualizacao', () => {
  it('registra o projeto e o evento numa transação e devolve o evento de saída', async () => {
    const { banco, repositorio } = montar();

    const resultado = await repositorio.processarAtualizacao(RECOMENDACAO);

    expect(resultado.situacao).toBe('registrada');
    expect(ehEventoProjeto(resultado.eventoSaida)).toBe(true);
    expect(banco.consultas).toEqual([
      'BEGIN',
      SQL.BUSCAR_EVENTO,
      SQL.BUSCAR_PROJETO,
      SQL.INSERIR_PROJETO,
      SQL.INSERIR_EVENTO,
      'COMMIT',
    ]);
    expect(banco.projetos.get('projeto-1')).toMatchObject({
      status: 'CRIADO',
      orcamento: '80000.00',
      requisitos: SNAPSHOT.requisitos,
      equipe_formada_id: null,
      metricas: expect.objectContaining({ rodadas: 1, profissionaisRecomendados: 2 }) as unknown,
    });
    expect(banco.eventos.get(RECOMENDACAO.id)).toMatchObject({
      tipo: 'RECOMENDACAO_GERADA',
      correlacao_id: 'req-1',
      dados: DADOS_RECOMENDACAO,
      evento_saida: resultado.eventoSaida,
      publicado: false,
    });
    expect(banco.liberacoes).toEqual([undefined]);
  });

  it('usa FOR UPDATE ao ler o evento e o projeto', () => {
    expect(SQL.BUSCAR_EVENTO).toMatch(/FOR UPDATE$/);
    expect(SQL.BUSCAR_PROJETO).toMatch(/FOR UPDATE$/);
    expect(SQL.INSERIR_PROJETO).toContain('$13::jsonb');
    expect(SQL.ATUALIZAR_PROJETO).toContain('metricas = $16::jsonb');
  });

  it('não duplica nada quando a mesma atualização chega de novo', async () => {
    const { banco, repositorio } = montar();
    const primeira = await repositorio.processarAtualizacao(RECOMENDACAO);
    await repositorio.marcarPublicado(RECOMENDACAO.id);
    banco.consultas.length = 0;

    const repetida = await repositorio.processarAtualizacao(RECOMENDACAO);

    expect(repetida).toEqual({ situacao: 'repetida', eventoSaida: primeira.eventoSaida });
    expect(banco.consultas).toEqual(['BEGIN', SQL.BUSCAR_EVENTO, 'COMMIT']);
    expect(banco.eventos.size).toBe(1);
    expect(banco.projetos.get('projeto-1')?.metricas).toMatchObject({ recomendacoesGeradas: 1 });
  });

  it('devolve o mesmo evento de saída como pendente quando ainda não foi publicado', async () => {
    const { repositorio } = montar();
    const primeira = await repositorio.processarAtualizacao(RECOMENDACAO);

    const repetida = await repositorio.processarAtualizacao(RECOMENDACAO);

    expect(repetida.situacao).toBe('pendente');
    expect(repetida.eventoSaida.id).toBe(primeira.eventoSaida.id);
  });

  it('atualiza o projeto existente pela leitura do banco e conta os eventos seguintes', async () => {
    const { banco, repositorio } = montar();
    await repositorio.processarAtualizacao(RECOMENDACAO);

    const convite = await repositorio.processarAtualizacao(
      criarAtualizacao('CONVITE_ENVIADO', {}, { ocorridoEm: '2026-11-22T12:10:00.000Z' }),
    );
    const formada = await repositorio.processarAtualizacao(
      criarAtualizacao('EQUIPE_FORMADA', DADOS_EQUIPE_FORMADA, {
        ocorridoEm: '2026-11-22T12:20:00.000Z',
        projeto: { equipeFormadaId: 'equipe-1' },
      }),
    );

    expect(convite.eventoSaida).toMatchObject({ id: 'saida-2', tipo: 'PROJETO_ATUALIZADO' });
    expect(convite.eventoSaida.dados.projeto.status).toBe('EM_ANDAMENTO');
    expect(formada.eventoSaida.tipo).toBe('PROJETO_FINALIZADO');
    expect(banco.consultas).toContain(SQL.ATUALIZAR_PROJETO);
    expect(banco.projetos.get('projeto-1')).toMatchObject({
      status: 'FINALIZADO',
      equipe_formada_id: 'equipe-1',
      finalizado_em: new Date('2026-11-22T12:20:00.000Z'),
      metricas: expect.objectContaining({
        rodadas: 1,
        convites: { enviados: 1, aceitos: 0, recusados: 0, expirados: 0 },
      }) as unknown,
    });
  });

  it('desfaz a transação e propaga a falha quando o banco cai no meio', async () => {
    const { banco, repositorio } = montar();
    banco.falharEm(SQL.INSERIR_EVENTO, new ErroPg('57P01', 'terminating connection'));

    await expect(repositorio.processarAtualizacao(RECOMENDACAO)).rejects.toThrow(
      'terminating connection',
    );

    expect(banco.consultas.at(-1)).toBe('ROLLBACK');
    expect(banco.projetos.size).toBe(0);
    expect(banco.eventos.size).toBe(0);
    expect(banco.liberacoes).toEqual([undefined]);
  });

  it('descarta a conexão quando nem o ROLLBACK responde', async () => {
    const { banco, repositorio } = montar();
    banco.falharEm(SQL.BUSCAR_EVENTO, new Error('Connection terminated'));
    banco.falhaRollback = new Error('Client was closed');

    await expect(repositorio.processarAtualizacao(RECOMENDACAO)).rejects.toThrow(
      'Connection terminated',
    );

    expect(banco.liberacoes).toEqual([new Error('Client was closed')]);
  });

  it('propaga a indisponibilidade do banco ao conectar', async () => {
    const { banco, repositorio } = montar();
    banco.falhaConexao = new Error('connect ECONNREFUSED 127.0.0.1:5433');

    await expect(repositorio.processarAtualizacao(RECOMENDACAO)).rejects.toThrow('ECONNREFUSED');
  });

  it('traduz dado recusado pelo banco (classe 22) para ErroAtualizacaoRecusada', async () => {
    const { banco, repositorio } = montar();

    await expect(
      repositorio.processarAtualizacao(
        criarAtualizacao('RECOMENDACAO_GERADA', {}, { projeto: { titulo: 'x'.repeat(201) } }),
      ),
    ).rejects.toBeInstanceOf(ErroAtualizacaoRecusada);
    expect(banco.projetos.size).toBe(0);
  });

  it('mantém conflito de chave (classe 23) como falha transitória', async () => {
    const { banco, repositorio } = montar();
    banco.falharEm(SQL.INSERIR_PROJETO, new ErroPg('23505', 'duplicate key'));

    const erro: unknown = await repositorio
      .processarAtualizacao(RECOMENDACAO)
      .catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ErroPg);
    expect(erro).not.toBeInstanceOf(ErroAtualizacaoRecusada);
  });
});

describe('ehErroDeDados', () => {
  it('reconhece só os códigos SQLSTATE da classe 22', () => {
    expect(ehErroDeDados(new ErroPg('22001', 'too long'))).toBe(true);
    expect(ehErroDeDados(new ErroPg('22003', 'numeric overflow'))).toBe(true);
    expect(ehErroDeDados(new ErroPg('23505', 'duplicate'))).toBe(false);
    expect(ehErroDeDados(new Error('sem código'))).toBe(false);
    expect(ehErroDeDados(null)).toBe(false);
  });
});

describe('RepositorioProjetos consultas', () => {
  it('obtém o projeto com os eventos recebidos, do mais novo para o mais antigo', async () => {
    const { repositorio } = montar();
    await repositorio.processarAtualizacao(RECOMENDACAO);
    await repositorio.marcarPublicado(RECOMENDACAO.id);
    await repositorio.processarAtualizacao(
      criarAtualizacao(
        'CONVITE_ENVIADO',
        {},
        { ocorridoEm: '2026-11-22T12:10:00.000Z', correlacaoId: null },
      ),
    );

    const projeto = await repositorio.obter('projeto-1');

    expect(projeto).toMatchObject({
      ...SNAPSHOT,
      status: 'EM_ANDAMENTO',
      criadoEm: '2026-11-22T12:00:00.000Z',
      atualizadoEm: '2026-11-22T12:10:00.000Z',
    });
    expect(projeto).not.toHaveProperty('finalizadoEm');
    expect(projeto?.eventos).toEqual([
      {
        eventoId: 'evento-convite_enviado',
        tipo: 'CONVITE_ENVIADO',
        ocorridoEm: '2026-11-22T12:10:00.000Z',
        recebidoEm: expect.any(String) as string,
        eventoSaida: { id: 'saida-2', tipo: 'PROJETO_ATUALIZADO' },
        publicado: false,
      },
      {
        eventoId: RECOMENDACAO.id,
        tipo: 'RECOMENDACAO_GERADA',
        ocorridoEm: '2026-11-22T12:00:00.000Z',
        recebidoEm: expect.any(String) as string,
        correlacaoId: 'req-1',
        eventoSaida: { id: 'saida-1', tipo: 'PROJETO_CRIADO' },
        publicado: true,
      },
    ]);
  });

  it('devolve undefined para projeto desconhecido', async () => {
    const { repositorio } = montar();

    await expect(repositorio.obter('nao-existe')).resolves.toBeUndefined();
  });

  it('lista com filtros por produtor e status, respeitando o limite', async () => {
    const { repositorio } = montar();
    await repositorio.processarAtualizacao(RECOMENDACAO);
    await repositorio.processarAtualizacao(
      criarAtualizacao('EQUIPE_FORMADA', DADOS_EQUIPE_FORMADA, {
        id: 'evento-outro',
        ocorridoEm: '2026-11-22T13:00:00.000Z',
        projeto: { id: 'projeto-2', produtorId: 'produtor-2' },
      }),
    );

    const todos = await repositorio.listar({ limite: 20 });
    const doProdutor = await repositorio.listar({ produtorId: 'produtor-2', limite: 20 });
    const criados = await repositorio.listar({ status: 'CRIADO', limite: 20 });
    const um = await repositorio.listar({ limite: 1 });

    expect(todos.map((projeto) => projeto.id)).toEqual(['projeto-2', 'projeto-1']);
    expect(doProdutor.map((projeto) => projeto.id)).toEqual(['projeto-2']);
    expect(doProdutor[0]).toMatchObject({
      status: 'FINALIZADO',
      finalizadoEm: '2026-11-22T13:00:00.000Z',
    });
    expect(criados.map((projeto) => projeto.id)).toEqual(['projeto-1']);
    expect(um).toHaveLength(1);
  });
});

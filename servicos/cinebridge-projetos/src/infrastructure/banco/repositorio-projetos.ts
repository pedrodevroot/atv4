import { randomUUID } from 'node:crypto';
import {
  ErroAtualizacaoRecusada,
  type ConsultaProjetos,
  type FiltrosProjetos,
  type ProjetoDetalhado,
  type RepositorioCicloVida,
  type ResultadoProcessamento,
  type ResumoProjeto,
} from '../../application/ports/repositorio-projetos.js';
import type { AtualizacaoProjeto } from '../../contratos/atualizacoes-projetos.js';
import type { EventoProjeto } from '../../contratos/eventos-projetos.js';
import { registrarAtualizacao } from '../../domain/registro-projeto.js';
import {
  COLUNAS_PROJETO,
  deLinhaEvento,
  deLinhaProjeto,
  parametrosProjeto,
  paraResumo,
  type LinhaEvento,
  type LinhaProjeto,
} from './mapeador-projeto.js';

export interface ResultadoSql {
  readonly rows: unknown[];
  readonly rowCount: number | null;
}

export interface ExecutorSql {
  query(sql: string, parametros?: unknown[]): Promise<ResultadoSql>;
}

export interface ClienteSql extends ExecutorSql {
  release(erro?: Error | boolean): void;
}

export interface PoolSql extends ExecutorSql {
  connect(): Promise<ClienteSql>;
}

export interface OpcoesRepositorioProjetos {
  readonly gerarId?: () => string;
  readonly agora?: () => Date;
  readonly limiteEventos?: number;
}

const SELECAO_PROJETO = `SELECT ${COLUNAS_PROJETO.join(', ')} FROM projeto`;

const ATRIBUICOES_PROJETO = COLUNAS_PROJETO.slice(1)
  .map((coluna, indice) => {
    const posicao = indice + 2;
    const conversao = coluna === 'requisitos' || coluna === 'metricas' ? '::jsonb' : '';
    return `${coluna} = $${posicao}${conversao}`;
  })
  .join(', ');

const VALORES_PROJETO = COLUNAS_PROJETO.map((coluna, indice) => {
  const conversao = coluna === 'requisitos' || coluna === 'metricas' ? '::jsonb' : '';
  return `$${indice + 1}${conversao}`;
}).join(', ');

export const SQL = {
  BUSCAR_EVENTO:
    'SELECT evento_saida, publicado FROM evento_projeto WHERE evento_id = $1 FOR UPDATE',
  BUSCAR_PROJETO: `${SELECAO_PROJETO} WHERE id = $1 FOR UPDATE`,
  INSERIR_PROJETO: `INSERT INTO projeto (${COLUNAS_PROJETO.join(', ')}) VALUES (${VALORES_PROJETO})`,
  ATUALIZAR_PROJETO: `UPDATE projeto SET ${ATRIBUICOES_PROJETO} WHERE id = $1`,
  INSERIR_EVENTO:
    'INSERT INTO evento_projeto (evento_id, projeto_id, tipo, ocorrido_em, correlacao_id, dados, evento_saida) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)',
  MARCAR_PUBLICADO: 'UPDATE evento_projeto SET publicado = true WHERE evento_id = $1',
  OBTER_PROJETO: `${SELECAO_PROJETO} WHERE id = $1`,
  LISTAR_EVENTOS:
    "SELECT evento_id, tipo, ocorrido_em, recebido_em, correlacao_id, evento_saida->>'id' AS evento_saida_id, evento_saida->>'tipo' AS evento_saida_tipo, publicado FROM evento_projeto WHERE projeto_id = $1 ORDER BY ocorrido_em DESC, recebido_em DESC LIMIT $2",
  LISTAR_PROJETOS: `${SELECAO_PROJETO} WHERE ($1::varchar IS NULL OR produtor_id = $1) AND ($2::varchar IS NULL OR status = $2) ORDER BY atualizado_em DESC, id LIMIT $3`,
} as const;

interface LinhaEventoExistente {
  readonly evento_saida: EventoProjeto;
  readonly publicado: boolean;
}

export const CLASSE_ERRO_DADOS = '22';

export function ehErroDeDados(erro: unknown): boolean {
  const codigo = (erro as { code?: unknown } | null)?.code;
  return typeof codigo === 'string' && codigo.startsWith(CLASSE_ERRO_DADOS);
}

function comoErro(erro: unknown): Error {
  return erro instanceof Error ? erro : new Error(String(erro));
}

export class RepositorioProjetos implements RepositorioCicloVida, ConsultaProjetos {
  private readonly gerarId: () => string;
  private readonly agora: () => Date;
  private readonly limiteEventos: number;

  constructor(
    private readonly pool: PoolSql,
    opcoes: OpcoesRepositorioProjetos = {},
  ) {
    this.gerarId = opcoes.gerarId ?? randomUUID;
    this.agora = opcoes.agora ?? (() => new Date());
    this.limiteEventos = opcoes.limiteEventos ?? 50;
  }

  async processarAtualizacao(atualizacao: AtualizacaoProjeto): Promise<ResultadoProcessamento> {
    const cliente = await this.pool.connect();
    let conexaoQuebrada: Error | undefined;
    try {
      await cliente.query('BEGIN');
      const resultado = await this.registrarNaTransacao(cliente, atualizacao);
      await cliente.query('COMMIT');
      return resultado;
    } catch (erro) {
      try {
        await cliente.query('ROLLBACK');
      } catch (falhaRollback) {
        conexaoQuebrada = comoErro(falhaRollback);
      }
      if (ehErroDeDados(erro)) {
        throw new ErroAtualizacaoRecusada(
          `O banco recusou a atualização ${atualizacao.id}: ${comoErro(erro).message}`,
          { cause: erro },
        );
      }
      throw erro;
    } finally {
      cliente.release(conexaoQuebrada);
    }
  }

  async marcarPublicado(eventoId: string): Promise<void> {
    await this.pool.query(SQL.MARCAR_PUBLICADO, [eventoId]);
  }

  async obter(id: string): Promise<ProjetoDetalhado | undefined> {
    const projetos = await this.pool.query(SQL.OBTER_PROJETO, [id]);
    const linha = projetos.rows[0] as LinhaProjeto | undefined;
    if (linha === undefined) {
      return undefined;
    }
    const eventos = await this.pool.query(SQL.LISTAR_EVENTOS, [id, this.limiteEventos]);
    return {
      ...paraResumo(deLinhaProjeto(linha)),
      eventos: (eventos.rows as LinhaEvento[]).map(deLinhaEvento),
    };
  }

  async listar(filtros: FiltrosProjetos): Promise<readonly ResumoProjeto[]> {
    const resultado = await this.pool.query(SQL.LISTAR_PROJETOS, [
      filtros.produtorId ?? null,
      filtros.status ?? null,
      filtros.limite,
    ]);
    return (resultado.rows as LinhaProjeto[]).map((linha) => paraResumo(deLinhaProjeto(linha)));
  }

  private async registrarNaTransacao(
    cliente: ClienteSql,
    atualizacao: AtualizacaoProjeto,
  ): Promise<ResultadoProcessamento> {
    const eventos = await cliente.query(SQL.BUSCAR_EVENTO, [atualizacao.id]);
    const existente = eventos.rows[0] as LinhaEventoExistente | undefined;
    if (existente !== undefined) {
      return {
        situacao: existente.publicado ? 'repetida' : 'pendente',
        eventoSaida: existente.evento_saida,
      };
    }

    const projetoId = atualizacao.dados.projeto.id;
    const projetos = await cliente.query(SQL.BUSCAR_PROJETO, [projetoId]);
    const linha = projetos.rows[0] as LinhaProjeto | undefined;
    const atual = linha === undefined ? undefined : deLinhaProjeto(linha);

    const { registro, eventoSaida } = registrarAtualizacao(atual, atualizacao, {
      idEventoSaida: this.gerarId(),
      agora: this.agora(),
    });

    await cliente.query(
      atual === undefined ? SQL.INSERIR_PROJETO : SQL.ATUALIZAR_PROJETO,
      parametrosProjeto(registro),
    );
    await cliente.query(SQL.INSERIR_EVENTO, [
      atualizacao.id,
      projetoId,
      atualizacao.tipo,
      atualizacao.ocorridoEm,
      atualizacao.correlacaoId ?? null,
      JSON.stringify(atualizacao.dados.evento),
      JSON.stringify(eventoSaida),
    ]);
    return { situacao: 'registrada', eventoSaida };
  }
}

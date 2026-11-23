import type { EventoProjeto } from '../../../../src/contratos/eventos-projetos.js';
import type { LinhaProjeto } from '../../../../src/infrastructure/banco/mapeador-projeto.js';
import {
  SQL,
  type ClienteSql,
  type PoolSql,
  type ResultadoSql,
} from '../../../../src/infrastructure/banco/repositorio-projetos.js';

export interface LinhaEventoArmazenada {
  readonly evento_id: string;
  readonly projeto_id: string;
  readonly tipo: string;
  readonly ocorrido_em: Date;
  readonly recebido_em: Date;
  readonly correlacao_id: string | null;
  readonly dados: unknown;
  readonly evento_saida: EventoProjeto;
  publicado: boolean;
}

interface Estado {
  projetos: Map<string, LinhaProjeto>;
  eventos: Map<string, LinhaEventoArmazenada>;
}

export class ErroPg extends Error {
  constructor(
    readonly code: string,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

const LIMITES_TEXTO: Partial<Record<keyof LinhaProjeto, number>> = {
  titulo: 200,
  genero: 80,
  cidade: 120,
  estrategia: 64,
  tipo_captacao: 20,
};

function resultado(rows: unknown[], rowCount = rows.length): ResultadoSql {
  return { rows, rowCount };
}

function texto(valor: unknown): string {
  return String(valor);
}

function jsonb(valor: unknown): unknown {
  return JSON.parse(texto(valor)) as unknown;
}

function dataOuNulo(valor: unknown): Date | null {
  return valor === null ? null : new Date(texto(valor));
}

function linhaDeParametros(parametros: readonly unknown[]): LinhaProjeto {
  const [
    id,
    titulo,
    produtorId,
    tipoCaptacao,
    genero,
    duracao,
    orcamento,
    inicio,
    entrega,
    cidade,
    uf,
    estrategia,
    requisitos,
    equipeFormadaId,
    status,
    metricas,
    criadoEm,
    atualizadoEm,
    finalizadoEm,
  ] = parametros;
  const linha: LinhaProjeto = {
    id: texto(id),
    titulo: texto(titulo),
    produtor_id: texto(produtorId),
    tipo_captacao: texto(tipoCaptacao),
    genero: texto(genero),
    duracao_minutos: Number(duracao),
    orcamento: Number(orcamento).toFixed(2),
    data_inicio: new Date(texto(inicio)),
    data_entrega: new Date(texto(entrega)),
    cidade: texto(cidade),
    uf: texto(uf).padEnd(2, ' '),
    estrategia: texto(estrategia),
    requisitos: jsonb(requisitos),
    equipe_formada_id: equipeFormadaId === null ? null : texto(equipeFormadaId),
    status: texto(status),
    metricas: jsonb(metricas),
    criado_em: new Date(texto(criadoEm)),
    atualizado_em: new Date(texto(atualizadoEm)),
    finalizado_em: dataOuNulo(finalizadoEm),
  };
  for (const [coluna, limite] of Object.entries(LIMITES_TEXTO)) {
    const valor = linha[coluna as keyof LinhaProjeto];
    if (typeof valor === 'string' && valor.length > limite) {
      throw new ErroPg('22001', `value too long for type character varying(${limite})`);
    }
  }
  return linha;
}

export class BancoFalso implements PoolSql {
  estado: Estado = { projetos: new Map(), eventos: new Map() };
  readonly consultas: string[] = [];
  readonly liberacoes: (Error | boolean | undefined)[] = [];
  readonly falhas = new Map<string, Error>();
  falhaConexao: Error | undefined;
  falhaRollback: Error | undefined;
  private copia: Estado | undefined;

  get projetos(): Map<string, LinhaProjeto> {
    return this.estado.projetos;
  }

  get eventos(): Map<string, LinhaEventoArmazenada> {
    return this.estado.eventos;
  }

  falharEm(sql: string, erro: Error = new Error('falha simulada')): void {
    this.falhas.set(sql, erro);
  }

  async connect(): Promise<ClienteSql> {
    if (this.falhaConexao) {
      throw this.falhaConexao;
    }
    return {
      query: (sql, parametros) => this.query(sql, parametros),
      release: (erro) => {
        this.liberacoes.push(erro);
      },
    };
  }

  async query(sql: string, parametros: unknown[] = []): Promise<ResultadoSql> {
    this.consultas.push(sql);
    const falha = this.falhas.get(sql);
    if (falha) {
      this.falhas.delete(sql);
      throw falha;
    }
    switch (sql) {
      case 'BEGIN':
        this.copia = structuredClone(this.estado);
        return resultado([]);
      case 'COMMIT':
        this.copia = undefined;
        return resultado([]);
      case 'ROLLBACK':
        if (this.falhaRollback) {
          throw this.falhaRollback;
        }
        if (this.copia) {
          this.estado = this.copia;
        }
        this.copia = undefined;
        return resultado([]);
      case SQL.BUSCAR_EVENTO: {
        const evento = this.eventos.get(texto(parametros[0]));
        return resultado(
          evento ? [{ evento_saida: evento.evento_saida, publicado: evento.publicado }] : [],
        );
      }
      case SQL.BUSCAR_PROJETO:
      case SQL.OBTER_PROJETO: {
        const projeto = this.projetos.get(texto(parametros[0]));
        return resultado(projeto ? [projeto] : []);
      }
      case SQL.INSERIR_PROJETO: {
        const linha = linhaDeParametros(parametros);
        if (this.projetos.has(linha.id)) {
          throw new ErroPg(
            '23505',
            'duplicate key value violates unique constraint "projeto_pkey"',
          );
        }
        this.projetos.set(linha.id, linha);
        return resultado([], 1);
      }
      case SQL.ATUALIZAR_PROJETO: {
        const linha = linhaDeParametros(parametros);
        const existia = this.projetos.has(linha.id);
        this.projetos.set(linha.id, linha);
        return resultado([], existia ? 1 : 0);
      }
      case SQL.INSERIR_EVENTO:
        return this.inserirEvento(parametros);
      case SQL.MARCAR_PUBLICADO: {
        const evento = this.eventos.get(texto(parametros[0]));
        if (evento) {
          evento.publicado = true;
        }
        return resultado([], evento ? 1 : 0);
      }
      case SQL.LISTAR_EVENTOS:
        return this.listarEventos(texto(parametros[0]), Number(parametros[1]));
      case SQL.LISTAR_PROJETOS:
        return this.listarProjetos(parametros);
      default:
        throw new Error(`SQL não esperado pelo banco falso: ${sql}`);
    }
  }

  private inserirEvento(parametros: readonly unknown[]): ResultadoSql {
    const [eventoId, projetoId, tipo, ocorridoEm, correlacaoId, dados, eventoSaida] = parametros;
    const id = texto(eventoId);
    if (this.eventos.has(id)) {
      throw new ErroPg('23505', 'duplicate key value violates unique constraint');
    }
    if (!this.projetos.has(texto(projetoId))) {
      throw new ErroPg('23503', 'violates foreign key constraint');
    }
    this.eventos.set(id, {
      evento_id: id,
      projeto_id: texto(projetoId),
      tipo: texto(tipo),
      ocorrido_em: new Date(texto(ocorridoEm)),
      recebido_em: new Date(),
      correlacao_id: correlacaoId === null ? null : texto(correlacaoId),
      dados: jsonb(dados),
      evento_saida: jsonb(eventoSaida) as EventoProjeto,
      publicado: false,
    });
    return resultado([], 1);
  }

  private listarEventos(projetoId: string, limite: number): ResultadoSql {
    const linhas = [...this.eventos.values()]
      .filter((evento) => evento.projeto_id === projetoId)
      .sort((a, b) => b.ocorrido_em.getTime() - a.ocorrido_em.getTime())
      .slice(0, limite)
      .map((evento) => ({
        evento_id: evento.evento_id,
        tipo: evento.tipo,
        ocorrido_em: evento.ocorrido_em,
        recebido_em: evento.recebido_em,
        correlacao_id: evento.correlacao_id,
        evento_saida_id: evento.evento_saida.id,
        evento_saida_tipo: evento.evento_saida.tipo,
        publicado: evento.publicado,
      }));
    return resultado(linhas);
  }

  private listarProjetos(parametros: readonly unknown[]): ResultadoSql {
    const [produtorId, status, limite] = parametros;
    const linhas = [...this.projetos.values()]
      .filter((linha) => produtorId === null || linha.produtor_id === produtorId)
      .filter((linha) => status === null || linha.status === status)
      .sort((a, b) => new Date(b.atualizado_em).getTime() - new Date(a.atualizado_em).getTime())
      .slice(0, Number(limite));
    return resultado(linhas);
  }
}

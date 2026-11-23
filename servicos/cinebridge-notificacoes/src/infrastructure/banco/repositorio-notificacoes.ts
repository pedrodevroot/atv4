import type { Pool } from 'pg';
import type {
  FiltroNotificacoes,
  NotificacaoRegistrada,
  NovaNotificacao,
  RepositorioNotificacoes,
} from '../../application/ports/repositorio-notificacoes.js';
import type { CanalNotificacao, TipoDestinatario } from '../../domain/aviso.js';

export interface LinhaNotificacao {
  id: string | number;
  evento_id: string;
  tipo_evento: string;
  motivo: string;
  projeto_id: string;
  destinatario_id: string;
  tipo_destinatario: string;
  canal: string;
  assunto: string;
  corpo: string;
  correlacao_id: string | null;
  criada_em: Date | string;
}

const INSERIR_NOTIFICACAO = `
INSERT INTO notificacao
  (evento_id, tipo_evento, motivo, projeto_id, destinatario_id, tipo_destinatario, canal, assunto, corpo, correlacao_id)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
ON CONFLICT ON CONSTRAINT ux_notificacao_entrega DO NOTHING
RETURNING id`;

const COLUNAS = `id, evento_id, tipo_evento, motivo, projeto_id, destinatario_id, tipo_destinatario,
  canal, assunto, corpo, correlacao_id, criada_em`;

export function paraNotificacao(linha: LinhaNotificacao): NotificacaoRegistrada {
  return {
    id: Number(linha.id),
    eventoId: linha.evento_id,
    tipoEvento: linha.tipo_evento,
    motivo: linha.motivo,
    projetoId: linha.projeto_id,
    destinatarioId: linha.destinatario_id,
    tipoDestinatario: linha.tipo_destinatario as TipoDestinatario,
    canal: linha.canal as CanalNotificacao,
    assunto: linha.assunto,
    corpo: linha.corpo,
    correlacaoId: linha.correlacao_id,
    criadaEm: new Date(linha.criada_em).toISOString(),
  };
}

export class RepositorioNotificacoesPostgres implements RepositorioNotificacoes {
  constructor(private readonly pool: Pick<Pool, 'query'>) {}

  async registrar(notificacao: NovaNotificacao): Promise<boolean> {
    const resultado = await this.pool.query(INSERIR_NOTIFICACAO, [
      notificacao.eventoId,
      notificacao.tipoEvento,
      notificacao.motivo,
      notificacao.projetoId,
      notificacao.destinatarioId,
      notificacao.tipoDestinatario,
      notificacao.canal,
      notificacao.assunto,
      notificacao.corpo,
      notificacao.correlacaoId ?? null,
    ]);
    return (resultado.rowCount ?? 0) > 0;
  }

  async listar(filtro: FiltroNotificacoes): Promise<readonly NotificacaoRegistrada[]> {
    const condicoes: string[] = [];
    const parametros: unknown[] = [];
    const adicionar = (coluna: string, valor: string | undefined): void => {
      if (valor !== undefined) {
        parametros.push(valor);
        condicoes.push(`${coluna} = $${parametros.length}`);
      }
    };
    adicionar('destinatario_id', filtro.destinatarioId);
    adicionar('projeto_id', filtro.projetoId);
    adicionar('canal', filtro.canal);
    parametros.push(filtro.limite);

    const where = condicoes.length > 0 ? `WHERE ${condicoes.join(' AND ')}` : '';
    const resultado = await this.pool.query<LinhaNotificacao>(
      `SELECT ${COLUNAS} FROM notificacao ${where} ORDER BY criada_em DESC, id DESC LIMIT $${parametros.length}`,
      parametros,
    );
    return resultado.rows.map(paraNotificacao);
  }
}

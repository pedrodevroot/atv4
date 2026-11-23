import type { CanalNotificacao, TipoDestinatario } from '../../domain/aviso.js';

export interface NovaNotificacao {
  readonly eventoId: string;
  readonly tipoEvento: string;
  readonly motivo: string;
  readonly projetoId: string;
  readonly destinatarioId: string;
  readonly tipoDestinatario: TipoDestinatario;
  readonly canal: CanalNotificacao;
  readonly assunto: string;
  readonly corpo: string;
  readonly correlacaoId?: string;
}

export interface NotificacaoRegistrada {
  readonly id: number;
  readonly eventoId: string;
  readonly tipoEvento: string;
  readonly motivo: string;
  readonly projetoId: string;
  readonly destinatarioId: string;
  readonly tipoDestinatario: TipoDestinatario;
  readonly canal: CanalNotificacao;
  readonly assunto: string;
  readonly corpo: string;
  readonly correlacaoId: string | null;
  readonly criadaEm: string;
}

export interface FiltroNotificacoes {
  readonly destinatarioId?: string;
  readonly projetoId?: string;
  readonly canal?: CanalNotificacao;
  readonly limite: number;
}

export interface RepositorioNotificacoes {
  registrar(notificacao: NovaNotificacao): Promise<boolean>;
  listar(filtro: FiltroNotificacoes): Promise<readonly NotificacaoRegistrada[]>;
}

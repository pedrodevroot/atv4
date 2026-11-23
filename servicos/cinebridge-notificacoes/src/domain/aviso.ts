export const TIPOS_DESTINATARIO = ['PRODUTOR', 'PROFISSIONAL'] as const;
export type TipoDestinatario = (typeof TIPOS_DESTINATARIO)[number];

export const CANAIS_NOTIFICACAO = ['EMAIL', 'INTERNA'] as const;
export type CanalNotificacao = (typeof CANAIS_NOTIFICACAO)[number];

export interface Aviso {
  readonly destinatarioId: string;
  readonly tipoDestinatario: TipoDestinatario;
  readonly assunto: string;
  readonly corpo: string;
}

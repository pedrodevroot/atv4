export interface PropriedadesMensagem {
  readonly messageId?: string;
  readonly correlationId?: string;
  readonly replyTo?: string;
  readonly type?: string;
  readonly contentType?: string;
  readonly expiration?: string;
  readonly timestamp?: number;
  readonly headers: Readonly<Record<string, unknown>>;
}

export interface MensagemRecebida<T> {
  readonly fila: string;
  readonly conteudo: T;
  readonly propriedades: PropriedadesMensagem;
  readonly reentregue: boolean;
}

export interface ObservadorMensagem<T> {
  readonly nome: string;
  atualizar(mensagem: MensagemRecebida<T>): Promise<void>;
}

export interface FalhaObservadorMensagem {
  readonly observador: string;
  readonly erro: unknown;
}

export interface SujeitoMensagens<T> {
  adicionarObservador(observador: ObservadorMensagem<T>): void;
  removerObservador(observador: ObservadorMensagem<T>): void;
  notificarObservadores(mensagem: MensagemRecebida<T>): Promise<readonly FalhaObservadorMensagem[]>;
}

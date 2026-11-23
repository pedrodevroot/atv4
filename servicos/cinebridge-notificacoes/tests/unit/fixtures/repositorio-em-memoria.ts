import type {
  FiltroNotificacoes,
  NotificacaoRegistrada,
  NovaNotificacao,
  RepositorioNotificacoes,
} from '../../../src/application/ports/repositorio-notificacoes.js';

export class RepositorioEmMemoria implements RepositorioNotificacoes {
  readonly linhas: NotificacaoRegistrada[] = [];
  readonly tentativas: NovaNotificacao[] = [];
  falharNoCanal: string | undefined;
  falhasRestantes = 0;

  registrar(notificacao: NovaNotificacao): Promise<boolean> {
    this.tentativas.push(notificacao);
    if (this.falharNoCanal === notificacao.canal && this.falhasRestantes > 0) {
      this.falhasRestantes -= 1;
      return Promise.reject(new Error('banco indisponível'));
    }
    const existe = this.linhas.some(
      (linha) =>
        linha.eventoId === notificacao.eventoId &&
        linha.destinatarioId === notificacao.destinatarioId &&
        linha.canal === notificacao.canal &&
        linha.assunto === notificacao.assunto,
    );
    if (existe) {
      return Promise.resolve(false);
    }
    this.linhas.push({
      id: this.linhas.length + 1,
      eventoId: notificacao.eventoId,
      tipoEvento: notificacao.tipoEvento,
      motivo: notificacao.motivo,
      projetoId: notificacao.projetoId,
      destinatarioId: notificacao.destinatarioId,
      tipoDestinatario: notificacao.tipoDestinatario,
      canal: notificacao.canal,
      assunto: notificacao.assunto,
      corpo: notificacao.corpo,
      correlacaoId: notificacao.correlacaoId ?? null,
      criadaEm: '2026-11-22T12:00:02.000Z',
    });
    return Promise.resolve(true);
  }

  listar(filtro: FiltroNotificacoes): Promise<readonly NotificacaoRegistrada[]> {
    return Promise.resolve(
      this.linhas
        .filter(
          (linha) =>
            (filtro.destinatarioId === undefined ||
              linha.destinatarioId === filtro.destinatarioId) &&
            (filtro.projetoId === undefined || linha.projetoId === filtro.projetoId) &&
            (filtro.canal === undefined || linha.canal === filtro.canal),
        )
        .slice(0, filtro.limite),
    );
  }
}

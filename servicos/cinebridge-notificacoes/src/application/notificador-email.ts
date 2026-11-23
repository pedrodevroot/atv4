import type { EventoProjeto } from '../contratos/eventos-projetos.js';
import type { LoggerMensageria } from '../infrastructure/mensageria/conexao-rabbitmq.js';
import type { MensagemRecebida, ObservadorMensagem } from './ports/observador-mensagem.js';
import type { RepositorioNotificacoes } from './ports/repositorio-notificacoes.js';
import { registrarAvisos } from './registrar-avisos.js';

export class NotificadorEmail implements ObservadorMensagem<EventoProjeto> {
  readonly nome = 'notificador-email';

  constructor(
    private readonly repositorio: RepositorioNotificacoes,
    private readonly logger: LoggerMensageria,
  ) {}

  async atualizar(mensagem: MensagemRecebida<EventoProjeto>): Promise<void> {
    const evento = mensagem.conteudo;
    const { novos, repetidos } = await registrarAvisos(this.repositorio, evento, 'EMAIL');
    const contexto = {
      canal: 'EMAIL',
      eventoId: evento.id,
      tipoEvento: evento.tipo,
      motivo: evento.dados.motivo,
      projetoId: evento.dados.projeto.id,
      correlationId: evento.correlacaoId ?? mensagem.propriedades.correlationId,
    };
    for (const aviso of novos) {
      this.logger.info(
        {
          ...contexto,
          destinatarioId: aviso.destinatarioId,
          tipoDestinatario: aviso.tipoDestinatario,
          assunto: aviso.assunto,
        },
        `E-mail enviado para ${aviso.destinatarioId}: ${aviso.assunto}`,
      );
    }
    for (const aviso of repetidos) {
      this.logger.info(
        {
          ...contexto,
          destinatarioId: aviso.destinatarioId,
          assunto: aviso.assunto,
          reentregue: mensagem.reentregue,
        },
        `E-mail já enviado antes para ${aviso.destinatarioId}; envio repetido ignorado`,
      );
    }
  }
}

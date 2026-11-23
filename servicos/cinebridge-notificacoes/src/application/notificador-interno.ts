import type { EventoProjeto } from '../contratos/eventos-projetos.js';
import type { LoggerMensageria } from '../infrastructure/mensageria/conexao-rabbitmq.js';
import type { MensagemRecebida, ObservadorMensagem } from './ports/observador-mensagem.js';
import type { RepositorioNotificacoes } from './ports/repositorio-notificacoes.js';
import { registrarAvisos } from './registrar-avisos.js';

export class NotificadorInterno implements ObservadorMensagem<EventoProjeto> {
  readonly nome = 'notificador-interno';

  constructor(
    private readonly repositorio: RepositorioNotificacoes,
    private readonly logger: LoggerMensageria,
  ) {}

  async atualizar(mensagem: MensagemRecebida<EventoProjeto>): Promise<void> {
    const evento = mensagem.conteudo;
    const { novos } = await registrarAvisos(this.repositorio, evento, 'INTERNA');
    for (const aviso of novos) {
      this.logger.info(
        {
          canal: 'INTERNA',
          eventoId: evento.id,
          tipoEvento: evento.tipo,
          motivo: evento.dados.motivo,
          projetoId: evento.dados.projeto.id,
          destinatarioId: aviso.destinatarioId,
          tipoDestinatario: aviso.tipoDestinatario,
          assunto: aviso.assunto,
          correlationId: evento.correlacaoId ?? mensagem.propriedades.correlationId,
        },
        `Mensagem interna entregue para ${aviso.destinatarioId}: ${aviso.assunto}`,
      );
    }
  }
}

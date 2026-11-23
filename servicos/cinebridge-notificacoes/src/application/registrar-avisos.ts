import type { EventoProjeto } from '../contratos/eventos-projetos.js';
import type { Aviso, CanalNotificacao } from '../domain/aviso.js';
import { comporAvisos } from '../domain/compositor-notificacoes.js';
import type { RepositorioNotificacoes } from './ports/repositorio-notificacoes.js';

export interface ResultadoRegistro {
  readonly novos: readonly Aviso[];
  readonly repetidos: readonly Aviso[];
}

export async function registrarAvisos(
  repositorio: RepositorioNotificacoes,
  evento: EventoProjeto,
  canal: CanalNotificacao,
): Promise<ResultadoRegistro> {
  const novos: Aviso[] = [];
  const repetidos: Aviso[] = [];
  for (const aviso of comporAvisos(evento)) {
    const inseriu = await repositorio.registrar({
      eventoId: evento.id,
      tipoEvento: evento.tipo,
      motivo: evento.dados.motivo,
      projetoId: evento.dados.projeto.id,
      destinatarioId: aviso.destinatarioId,
      tipoDestinatario: aviso.tipoDestinatario,
      canal,
      assunto: aviso.assunto,
      corpo: aviso.corpo,
      ...(evento.correlacaoId === undefined ? {} : { correlacaoId: evento.correlacaoId }),
    });
    (inseriu ? novos : repetidos).push(aviso);
  }
  return { novos, repetidos };
}

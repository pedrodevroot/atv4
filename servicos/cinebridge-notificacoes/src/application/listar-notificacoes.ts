import type {
  FiltroNotificacoes,
  NotificacaoRegistrada,
  RepositorioNotificacoes,
} from './ports/repositorio-notificacoes.js';

export const LIMITE_PADRAO = 50;
export const LIMITE_MAXIMO = 200;

export class ListarNotificacoes {
  constructor(private readonly repositorio: RepositorioNotificacoes) {}

  executar(
    filtro: Omit<FiltroNotificacoes, 'limite'> & { limite?: number },
  ): Promise<readonly NotificacaoRegistrada[]> {
    const limite = Math.min(Math.max(Math.trunc(filtro.limite ?? LIMITE_PADRAO), 1), LIMITE_MAXIMO);
    return this.repositorio.listar({ ...filtro, limite });
  }
}

import type { LoggerServico } from './ports/logger-servico.js';

export interface PassosInicializacao {
  migrar(): Promise<readonly string[]>;
  semear(): Promise<number>;
  iniciarMensageria(): Promise<void>;
}

export interface OpcoesInicializacao {
  readonly atrasoNovaTentativaMs: number;
  readonly encerrando: () => boolean;
  readonly aguardar?: (ms: number) => Promise<void>;
}

const aguardarPadrao = (ms: number): Promise<void> =>
  new Promise((resolver) => {
    setTimeout(resolver, ms);
  });

export async function inicializarServico(
  passos: PassosInicializacao,
  logger: LoggerServico,
  opcoes: OpcoesInicializacao,
): Promise<boolean> {
  const aguardar = opcoes.aguardar ?? aguardarPadrao;
  while (!opcoes.encerrando()) {
    try {
      const aplicadas = await passos.migrar();
      logger.info({ aplicadas }, 'Conectado ao PostgreSQL; migrações em dia');
      await passos.semear();
      await passos.iniciarMensageria();
      return true;
    } catch (erro) {
      logger.warn({ err: erro }, 'Preparação do serviço falhou; nova tentativa em instantes');
      await aguardar(opcoes.atrasoNovaTentativaMs);
    }
  }
  return false;
}

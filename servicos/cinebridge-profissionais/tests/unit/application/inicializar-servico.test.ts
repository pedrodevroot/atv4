import { describe, expect, it, vi } from 'vitest';
import { inicializarServico } from '../../../src/application/inicializar-servico.js';
import { criarLoggerFalso } from '../infrastructure/mensageria/dubles-rabbitmq.js';

function criarPassos(falhasMigracao = 0) {
  const ordem: string[] = [];
  let restantes = falhasMigracao;
  return {
    ordem,
    passos: {
      migrar: vi.fn(() => {
        ordem.push('migrar');
        if (restantes > 0) {
          restantes -= 1;
          return Promise.reject(new Error('banco fora'));
        }
        return Promise.resolve(['001']);
      }),
      semear: vi.fn(() => {
        ordem.push('semear');
        return Promise.resolve(10);
      }),
      iniciarMensageria: vi.fn(() => {
        ordem.push('mensageria');
        return Promise.resolve();
      }),
    },
  };
}

describe('inicializarServico', () => {
  it('migra, semeia e só depois inicia a mensageria', async () => {
    const { passos, ordem } = criarPassos();
    const { logger } = criarLoggerFalso();

    await expect(
      inicializarServico(passos, logger, { atrasoNovaTentativaMs: 1, encerrando: () => false }),
    ).resolves.toBe(true);

    expect(ordem).toEqual(['migrar', 'semear', 'mensageria']);
  });

  it('repete tudo depois de uma falha, esperando o atraso', async () => {
    const { passos, ordem } = criarPassos(2);
    const { logger, mensagens } = criarLoggerFalso();
    const aguardar = vi.fn<(ms: number) => Promise<void>>(() => Promise.resolve());

    await inicializarServico(passos, logger, {
      atrasoNovaTentativaMs: 2_000,
      encerrando: () => false,
      aguardar,
    });

    expect(aguardar).toHaveBeenCalledTimes(2);
    expect(aguardar).toHaveBeenCalledWith(2_000);
    expect(ordem).toEqual(['migrar', 'migrar', 'migrar', 'semear', 'mensageria']);
    expect(mensagens('warn')).toHaveLength(2);
  });

  it('para de tentar quando o serviço está encerrando', async () => {
    const { passos } = criarPassos(5);
    const { logger } = criarLoggerFalso();
    let tentativas = 0;

    const concluiu = await inicializarServico(passos, logger, {
      atrasoNovaTentativaMs: 1,
      encerrando: () => tentativas >= 1,
      aguardar: () => {
        tentativas += 1;
        return Promise.resolve();
      },
    });

    expect(concluiu).toBe(false);
    expect(passos.migrar).toHaveBeenCalledOnce();
    expect(passos.iniciarMensageria).not.toHaveBeenCalled();
  });

  it('usa o temporizador real quando não recebe um aguardar', async () => {
    vi.useFakeTimers();
    const { passos } = criarPassos(1);
    const { logger } = criarLoggerFalso();

    const execucao = inicializarServico(passos, logger, {
      atrasoNovaTentativaMs: 500,
      encerrando: () => false,
    });
    await vi.advanceTimersByTimeAsync(500);

    await expect(execucao).resolves.toBe(true);
    vi.useRealTimers();
  });
});

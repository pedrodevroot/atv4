import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INTERVALO_AQUECIMENTO_MS,
  aquecerComNovasTentativas,
} from '../../../src/infrastructure/agendamento/aquecimento-com-novas-tentativas.js';

describe('aquecerComNovasTentativas', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('tenta logo na partida e para na primeira tentativa bem-sucedida', async () => {
    const aquecer = vi.fn(() => Promise.resolve(true));
    const aoConcluir = vi.fn();

    const aquecimento = aquecerComNovasTentativas(aquecer, { aoConcluir });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(INTERVALO_AQUECIMENTO_MS * 3);

    expect(aquecer).toHaveBeenCalledTimes(1);
    expect(aquecimento.concluido).toBe(true);
    expect(aquecimento.tentativas).toBe(1);
    expect(aoConcluir).toHaveBeenCalledWith(1);
  });

  it('repete no intervalo enquanto falha, inclusive quando a tentativa lança, sem derrubar nada', async () => {
    const resultados = [false, 'lanca', false, true] as const;
    const aquecer = vi.fn(() => {
      const proximo = resultados[aquecer.mock.calls.length - 1];
      return proximo === 'lanca'
        ? Promise.reject(new Error('fila fora do ar'))
        : Promise.resolve(proximo ?? false);
    });
    const aoFalhar = vi.fn();

    const aquecimento = aquecerComNovasTentativas(aquecer, { intervaloMs: 1_000, aoFalhar });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(999);
    const antesDoIntervalo = aquecer.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3_000);

    expect(antesDoIntervalo).toBe(1);
    expect(aquecer).toHaveBeenCalledTimes(4);
    expect(aoFalhar.mock.calls).toEqual([
      [1, 1_000],
      [2, 1_000],
      [3, 1_000],
    ]);
    expect(aquecimento.concluido).toBe(true);
  });

  it('parar cancela as próximas tentativas, mesmo com uma em andamento', async () => {
    let liberar: (valor: boolean) => void = () => undefined;
    const aquecer = vi.fn(
      () =>
        new Promise<boolean>((resolver) => {
          liberar = resolver;
        }),
    );
    const aoFalhar = vi.fn();

    const aquecimento = aquecerComNovasTentativas(aquecer, { intervaloMs: 1_000, aoFalhar });
    aquecimento.parar();
    liberar(false);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(aquecer).toHaveBeenCalledTimes(1);
    expect(aoFalhar).not.toHaveBeenCalled();
    expect(aquecimento.concluido).toBe(false);
  });

  it('parar entre tentativas cancela o agendamento pendente', async () => {
    const aquecer = vi.fn(() => Promise.resolve(false));

    const aquecimento = aquecerComNovasTentativas(aquecer, { intervaloMs: 1_000 });
    await vi.advanceTimersByTimeAsync(0);
    aquecimento.parar();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(aquecer).toHaveBeenCalledTimes(1);
  });
});

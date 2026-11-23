import { describe, expect, it } from 'vitest';
import { ConsultarSaude } from '../../src/application/consultar-saude.js';
import type { VerificadorDependencia } from '../../src/application/ports/verificador-dependencia.js';

function verificador(nome: string, resultado: boolean | Error): VerificadorDependencia {
  return {
    nome,
    verificar: () =>
      resultado instanceof Error ? Promise.reject(resultado) : Promise.resolve(resultado),
  };
}

const AGORA = new Date('2026-11-22T12:00:00.000Z');

describe('ConsultarSaude', () => {
  it('informa ok quando todas as dependências estão disponíveis', async () => {
    const saude = new ConsultarSaude(
      [verificador('postgres', true), verificador('rabbitmq', true)],
      () => AGORA,
    );

    await expect(saude.executar()).resolves.toEqual({
      status: 'ok',
      timestamp: '2026-11-22T12:00:00.000Z',
      dependencias: { postgres: 'disponivel', rabbitmq: 'disponivel' },
    });
  });

  it('informa degradado quando uma dependência está indisponível', async () => {
    const saude = new ConsultarSaude(
      [verificador('postgres', false), verificador('rabbitmq', true)],
      () => AGORA,
    );

    const relatorio = await saude.executar();

    expect(relatorio.status).toBe('degradado');
    expect(relatorio.dependencias).toEqual({ postgres: 'indisponivel', rabbitmq: 'disponivel' });
  });

  it('trata falha do verificador como dependência indisponível', async () => {
    const saude = new ConsultarSaude([verificador('postgres', new Error('queda'))], () => AGORA);

    const relatorio = await saude.executar();

    expect(relatorio.status).toBe('degradado');
    expect(relatorio.dependencias).toEqual({ postgres: 'indisponivel' });
  });

  it('informa ok quando não há verificadores', async () => {
    const relatorio = await new ConsultarSaude([], () => AGORA).executar();

    expect(relatorio.status).toBe('ok');
  });
});

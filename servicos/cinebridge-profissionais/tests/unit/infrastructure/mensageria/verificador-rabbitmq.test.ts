import { describe, expect, expectTypeOf, it } from 'vitest';
import type { VerificadorDependencia } from '../../../../src/application/ports/verificador-dependencia.js';
import { VerificadorRabbitMQ } from '../../../../src/infrastructure/mensageria/verificador-rabbitmq.js';

describe('VerificadorRabbitMQ', () => {
  it('implementa a porta de verificação com o nome rabbitmq', () => {
    const verificador = new VerificadorRabbitMQ({ conectada: true });

    expectTypeOf(verificador).toExtend<VerificadorDependencia>();
    expect(verificador.nome).toBe('rabbitmq');
  });

  it('informa disponível com a conexão aberta e todos os consumidores ativos', async () => {
    const verificador = new VerificadorRabbitMQ({ conectada: true }, [{ ativo: true }]);

    await expect(verificador.verificar()).resolves.toBe(true);
  });

  it('informa indisponível sem conexão', async () => {
    const verificador = new VerificadorRabbitMQ({ conectada: false });

    await expect(verificador.verificar()).resolves.toBe(false);
  });

  it('informa indisponível quando um consumidor monitorado parou', async () => {
    const consumidor = { ativo: true };
    const verificador = new VerificadorRabbitMQ({ conectada: true });
    verificador.monitorar(consumidor);
    verificador.monitorar(consumidor);

    await expect(verificador.verificar()).resolves.toBe(true);
    consumidor.ativo = false;
    await expect(verificador.verificar()).resolves.toBe(false);
  });
});

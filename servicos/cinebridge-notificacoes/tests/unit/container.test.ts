import { describe, expect, it } from 'vitest';
import { carregarConfig } from '../../src/config.js';
import { MIGRACOES, criarContainer } from '../../src/container.js';
import { criarLogger, criarOpcoesLogger } from '../../src/infrastructure/logging/logger.js';

const OBRIGATORIAS = { DB_USER: 'usuario', DB_PASSWORD: 'senha', DB_NAME: 'banco' };

describe('criarOpcoesLogger', () => {
  it('silencia o log no ambiente de teste', () => {
    const config = carregarConfig({ ...OBRIGATORIAS, NODE_ENV: 'test' });

    expect(criarOpcoesLogger(config).level).toBe('silent');
  });

  it('usa pino-pretty em desenvolvimento', () => {
    const config = carregarConfig({ ...OBRIGATORIAS, NODE_ENV: 'development' });

    expect(criarOpcoesLogger(config).transport).toMatchObject({ target: 'pino-pretty' });
  });

  it('usa JSON puro em produção e identifica o serviço', () => {
    const config = carregarConfig({ ...OBRIGATORIAS, NODE_ENV: 'production' });
    const opcoes = criarOpcoesLogger(config);

    expect(opcoes.transport).toBeUndefined();
    expect(opcoes.base).toEqual({ servico: 'cinebridge-notificacoes' });
  });

  it('cria o logger', () => {
    const config = carregarConfig({ ...OBRIGATORIAS, NODE_ENV: 'test' });

    expect(criarLogger(config).level).toBe('silent');
  });
});

describe('criarContainer', () => {
  it('monta a saúde com os verificadores do banco e do RabbitMQ sem conectar', async () => {
    const config = carregarConfig({ ...OBRIGATORIAS, NODE_ENV: 'test' });
    const container = criarContainer(config, criarLogger(config));

    expect(container.verificadores.map((verificador) => verificador.nome)).toEqual([
      'postgres',
      'rabbitmq',
    ]);
    expect(container.verificadores).toContain(container.verificadorRabbitMQ);
    expect(container.conexaoRabbitMQ.conectada).toBe(false);
    expect(container.conexaoRabbitMQ.endereco).toBe('localhost:5672');
    await expect(container.verificadorRabbitMQ.verificar()).resolves.toBe(false);
    await container.encerrar();
    expect(container.conexaoRabbitMQ.encerrada).toBe(true);
  });

  it('registra os dois observadores no consumidor de eventos-projetos e o monitora na saúde', async () => {
    const config = carregarConfig({ ...OBRIGATORIAS, NODE_ENV: 'test', RABBITMQ_PREFETCH: '10' });
    const container = criarContainer(config, criarLogger(config));

    expect(container.consumidorEventos.fila).toBe('eventos-projetos');
    expect(container.consumidorEventos.nomesObservadores).toEqual([
      'notificador-email',
      'notificador-interno',
    ]);
    expect(container.consumidorEventos.ativo).toBe(false);
    expect(MIGRACOES.map((migracao) => migracao.id)).toEqual(['001-criar-notificacao']);
    await container.encerrar();
  });
});

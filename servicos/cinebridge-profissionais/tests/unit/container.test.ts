import { describe, expect, it } from 'vitest';
import { carregarConfig } from '../../src/config.js';
import { MIGRACOES, aceitarConsulta, criarContainer } from '../../src/container.js';
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
    expect(opcoes.base).toEqual({ servico: 'cinebridge-profissionais' });
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

  it('registra a migração do cadastro e o respondedor no consumidor de consulta-profissionais', async () => {
    const config = carregarConfig({ ...OBRIGATORIAS, NODE_ENV: 'test', RABBITMQ_PREFETCH: '7' });
    const container = criarContainer(config, criarLogger(config));

    expect(MIGRACOES.map((migracao) => migracao.id)).toEqual(['001-cadastro-profissionais']);
    expect(container.consumidor.fila).toBe('consulta-profissionais');
    expect(container.consumidor.nomesObservadores).toEqual(['RespondedorConsultaProfissionais']);
    expect(container.consumidor.ativo).toBe(false);
    await expect(container.verificadorRabbitMQ.verificar()).resolves.toBe(false);
    await container.encerrar();
  });

  it('aceita qualquer objeto JSON no consumidor para poder responder consultas inválidas', () => {
    expect(aceitarConsulta({ qualquer: 'coisa' })).toBe(true);
    expect(aceitarConsulta(null)).toBe(false);
    expect(aceitarConsulta([])).toBe(false);
    expect(aceitarConsulta('texto')).toBe(false);
  });
});

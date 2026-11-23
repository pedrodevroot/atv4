import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { construirApp, type App } from '../../src/app.js';
import { carregarConfig } from '../../src/config/config.js';
import { criarContainer, type Container } from '../../src/container.js';
import { ConexaoRabbitMQ } from '../../src/infrastructure/mensageria/rabbitmq/conexao-rabbitmq.js';
import {
  CONFIG_RABBITMQ,
  criarConectorFalso,
  criarLoggerFalso,
} from '../unit/infrastructure/mensageria/rabbitmq/dubles-rabbitmq.js';

function criarMensageriaFalsa() {
  return new ConexaoRabbitMQ(CONFIG_RABBITMQ, criarLoggerFalso().logger, {
    intervaloReconexaoMs: 1_000,
    conectar: criarConectorFalso().conectar,
  });
}

describe('GET /health com PostgreSQL real', () => {
  const mensageria = criarMensageriaFalsa();
  let container: Container;
  let app: App;

  beforeAll(async () => {
    container = criarContainer(carregarConfig(), undefined, { conexaoMensageria: mensageria });
    app = await construirApp(container);
    app.addHook('onClose', () => container.encerrar());
  });

  afterAll(async () => {
    await app.close();
  });

  it('responde 503 enquanto o RabbitMQ não está conectado e 200 depois que conecta', async () => {
    await container.conexao.garantir();
    const antes = await app.inject({ method: 'GET', url: '/health' });
    await mensageria.iniciar();
    const depois = await app.inject({ method: 'GET', url: '/health' });

    expect(antes.statusCode).toBe(503);
    expect(antes.json()).toMatchObject({
      status: 'degradado',
      dependencias: { postgres: 'disponivel', rabbitmq: 'indisponivel' },
    });
    expect(depois.statusCode).toBe(200);
    expect(depois.json()).toMatchObject({
      status: 'ok',
      dependencias: { postgres: 'disponivel', rabbitmq: 'disponivel' },
    });
  });

  it('responde 503 quando o banco está fora, mesmo com o RabbitMQ conectado', async () => {
    const semBanco = criarContainer(carregarConfig({ ...process.env, DB_PORT: '1' }), undefined, {
      conexaoMensageria: criarMensageriaFalsa(),
    });
    await semBanco.mensageria.iniciar();
    const appSemBanco = await construirApp(semBanco);

    const resposta = await appSemBanco.inject({ method: 'GET', url: '/health' });
    await appSemBanco.close();
    await semBanco.encerrar();

    expect(resposta.statusCode).toBe(503);
    expect(resposta.json()).toMatchObject({
      status: 'degradado',
      dependencias: { postgres: 'indisponivel', rabbitmq: 'disponivel' },
    });
  });

  it('conecta no PostgreSQL 15 ou superior', async () => {
    const [linha] = await container.dataSource.query<{ versao: string }[]>(
      "SELECT current_setting('server_version') AS versao",
    );

    expect(container.dataSource.isInitialized).toBe(true);
    expect(Number.parseInt(linha?.versao ?? '0', 10)).toBeGreaterThanOrEqual(15);
  });
});

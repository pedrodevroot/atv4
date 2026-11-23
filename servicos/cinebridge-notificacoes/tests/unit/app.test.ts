import { describe, expect, it } from 'vitest';
import { construirApp } from '../../src/app.js';
import { ConsultarSaude } from '../../src/application/consultar-saude.js';
import { ListarNotificacoes } from '../../src/application/listar-notificacoes.js';
import { RepositorioEmMemoria } from './fixtures/repositorio-em-memoria.js';

function criarApp(disponivel: boolean) {
  const saude = new ConsultarSaude([
    { nome: 'postgres', verificar: () => Promise.resolve(disponivel) },
  ]);
  return construirApp({
    consultarSaude: saude,
    listarNotificacoes: new ListarNotificacoes(new RepositorioEmMemoria()),
  });
}

describe('GET /health', () => {
  it('responde 200 quando as dependências estão disponíveis', async () => {
    const app = criarApp(true);

    const resposta = await app.inject({ method: 'GET', url: '/health' });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toMatchObject({
      status: 'ok',
      dependencias: { postgres: 'disponivel' },
    });
    await app.close();
  });

  it('responde 503 com status degradado quando uma dependência cai', async () => {
    const app = criarApp(false);

    const resposta = await app.inject({ method: 'GET', url: '/health' });

    expect(resposta.statusCode).toBe(503);
    expect(resposta.json()).toMatchObject({
      status: 'degradado',
      dependencias: { postgres: 'indisponivel' },
    });
    await app.close();
  });
});

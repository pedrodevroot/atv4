import { describe, expect, it } from 'vitest';
import { construirApp } from '../../../src/app.js';
import { ConsultarSaude } from '../../../src/application/consultar-saude.js';
import { ListarNotificacoes } from '../../../src/application/listar-notificacoes.js';
import { RepositorioEmMemoria } from '../fixtures/repositorio-em-memoria.js';

async function criarApp() {
  const repositorio = new RepositorioEmMemoria();
  const registros = [
    ['saida-1', 'produtor-1', 'PRODUTOR', 'EMAIL'],
    ['saida-1', 'produtor-1', 'PRODUTOR', 'INTERNA'],
    ['saida-1', 'prof-1', 'PROFISSIONAL', 'EMAIL'],
  ] as const;
  for (const [eventoId, destinatarioId, tipoDestinatario, canal] of registros) {
    await repositorio.registrar({
      eventoId,
      tipoEvento: 'PROJETO_CRIADO',
      motivo: 'RECOMENDACAO_GERADA',
      projetoId: 'projeto-1',
      destinatarioId,
      tipoDestinatario,
      canal,
      assunto: 'Assunto',
      corpo: 'Corpo',
      correlacaoId: 'req-1',
    });
  }
  await repositorio.registrar({
    eventoId: 'saida-2',
    tipoEvento: 'PROJETO_CRIADO',
    motivo: 'RECOMENDACAO_GERADA',
    projetoId: 'projeto-2',
    destinatarioId: 'produtor-2',
    tipoDestinatario: 'PRODUTOR',
    canal: 'EMAIL',
    assunto: 'Assunto',
    corpo: 'Corpo',
  });
  const saude = new ConsultarSaude([{ nome: 'postgres', verificar: () => Promise.resolve(true) }]);
  return construirApp({
    consultarSaude: saude,
    listarNotificacoes: new ListarNotificacoes(repositorio),
  });
}

describe('GET /notificacoes', () => {
  it('lista as notificações de um projeto nos dois canais', async () => {
    const app = await criarApp();

    const resposta = await app.inject({ method: 'GET', url: '/notificacoes?projetoId=projeto-1' });

    expect(resposta.statusCode).toBe(200);
    const corpo = resposta.json<{ quantidade: number; notificacoes: { canal: string }[] }>();
    expect(corpo.quantidade).toBe(3);
    expect(corpo.notificacoes.map((item) => item.canal).sort()).toEqual([
      'EMAIL',
      'EMAIL',
      'INTERNA',
    ]);
    expect(corpo.notificacoes[0]).toEqual({
      id: 1,
      eventoId: 'saida-1',
      tipoEvento: 'PROJETO_CRIADO',
      motivo: 'RECOMENDACAO_GERADA',
      projetoId: 'projeto-1',
      destinatarioId: 'produtor-1',
      tipoDestinatario: 'PRODUTOR',
      canal: 'EMAIL',
      assunto: 'Assunto',
      corpo: 'Corpo',
      correlacaoId: 'req-1',
      criadaEm: '2026-11-22T12:00:02.000Z',
    });
    await app.close();
  });

  it('filtra por destinatário e por canal', async () => {
    const app = await criarApp();

    const porDestinatario = await app.inject({
      method: 'GET',
      url: '/notificacoes?destinatarioId=prof-1',
    });
    const porCanal = await app.inject({
      method: 'GET',
      url: '/notificacoes?projetoId=projeto-1&canal=INTERNA',
    });

    expect(porDestinatario.json<{ quantidade: number }>().quantidade).toBe(1);
    expect(porCanal.json<{ quantidade: number }>().quantidade).toBe(1);
    await app.close();
  });

  it('sem filtros lista tudo e aplica o limite pedido', async () => {
    const app = await criarApp();

    const todas = await app.inject({ method: 'GET', url: '/notificacoes' });
    const limitada = await app.inject({ method: 'GET', url: '/notificacoes?limite=2' });

    expect(todas.json<{ quantidade: number }>().quantidade).toBe(4);
    expect(limitada.json<{ quantidade: number }>().quantidade).toBe(2);
    await app.close();
  });

  it('devolve lista vazia para um projeto sem avisos', async () => {
    const app = await criarApp();

    const resposta = await app.inject({ method: 'GET', url: '/notificacoes?projetoId=nenhum' });

    expect(resposta.json()).toEqual({ quantidade: 0, notificacoes: [] });
    await app.close();
  });

  it('recusa canal desconhecido e limite fora da faixa com 400', async () => {
    const app = await criarApp();

    for (const consulta of ['canal=SMS', 'limite=0', 'limite=201', 'limite=abc']) {
      const resposta = await app.inject({ method: 'GET', url: `/notificacoes?${consulta}` });
      expect(resposta.statusCode).toBe(400);
    }
    await app.close();
  });
});

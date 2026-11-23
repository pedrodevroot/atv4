import { describe, expect, it, vi } from 'vitest';
import { construirApp } from '../../../src/app.js';
import { ConsultarSaude } from '../../../src/application/consultar-saude.js';
import type {
  ConsultaProjetos,
  ProjetoDetalhado,
  ResumoProjeto,
} from '../../../src/application/ports/repositorio-projetos.js';
import { ehIndisponibilidadeBanco } from '../../../src/api/tratador-erros.js';
import { aplicarEvento, metricasIniciais } from '../../../src/domain/ciclo-vida.js';
import { DADOS_EQUIPE_FORMADA, SNAPSHOT } from '../fixtures.js';

const RESUMO: ResumoProjeto = {
  ...SNAPSHOT,
  equipeFormadaId: 'equipe-1',
  status: 'FINALIZADO',
  metricas: aplicarEvento(
    { ...metricasIniciais(), rodadas: 1, ultimaEstrategia: 'filtragem-colaborativa' },
    'EQUIPE_FORMADA',
    DADOS_EQUIPE_FORMADA,
  ),
  criadoEm: '2026-11-22T12:00:00.000Z',
  atualizadoEm: '2026-11-22T12:20:00.000Z',
  finalizadoEm: '2026-11-22T12:20:00.000Z',
};

const DETALHADO: ProjetoDetalhado = {
  ...RESUMO,
  eventos: [
    {
      eventoId: 'evento-1',
      tipo: 'EQUIPE_FORMADA',
      ocorridoEm: '2026-11-22T12:20:00.000Z',
      recebidoEm: '2026-11-22T12:20:01.000Z',
      correlacaoId: 'req-1',
      eventoSaida: { id: 'saida-1', tipo: 'PROJETO_FINALIZADO' },
      publicado: true,
    },
  ],
};

function montar(consulta: Partial<ConsultaProjetos> = {}) {
  const consultaProjetos = {
    obter: vi.fn(consulta.obter ?? (async () => DETALHADO)),
    listar: vi.fn(consulta.listar ?? (async () => [RESUMO])),
  };
  const app = construirApp({ consultarSaude: new ConsultarSaude([]), consultaProjetos });
  return { app, consultaProjetos };
}

describe('GET /projetos/:id', () => {
  it('devolve o registro com status, métricas e eventos recebidos', async () => {
    const { app, consultaProjetos } = montar();

    const resposta = await app.inject({ method: 'GET', url: '/projetos/projeto-1' });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toEqual(DETALHADO);
    expect(consultaProjetos.obter).toHaveBeenCalledWith('projeto-1');
    await app.close();
  });

  it('responde 404 quando o projeto não está registrado', async () => {
    const { app } = montar({ obter: async () => undefined });

    const resposta = await app.inject({ method: 'GET', url: '/projetos/desconhecido' });

    expect(resposta.statusCode).toBe(404);
    expect(resposta.json()).toMatchObject({ codigo: 'PROJETO_NAO_ENCONTRADO' });
    await app.close();
  });

  it('responde 503 quando o banco está indisponível', async () => {
    const { app } = montar({
      obter: async () => {
        throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      },
    });

    const resposta = await app.inject({ method: 'GET', url: '/projetos/projeto-1' });

    expect(resposta.statusCode).toBe(503);
    expect(resposta.json()).toMatchObject({ codigo: 'BANCO_INDISPONIVEL' });
    await app.close();
  });

  it('responde 500 para erro inesperado', async () => {
    const { app } = montar({
      obter: async () => {
        throw new Error('bug');
      },
    });

    const resposta = await app.inject({ method: 'GET', url: '/projetos/projeto-1' });

    expect(resposta.statusCode).toBe(500);
    expect(resposta.json()).toMatchObject({ codigo: 'ERRO_INTERNO' });
    await app.close();
  });
});

describe('GET /projetos', () => {
  it('lista com o limite padrão de 20', async () => {
    const { app, consultaProjetos } = montar();

    const resposta = await app.inject({ method: 'GET', url: '/projetos' });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toEqual({ projetos: [RESUMO] });
    expect(consultaProjetos.listar).toHaveBeenCalledWith({ limite: 20 });
    await app.close();
  });

  it('repassa produtor, status e limite', async () => {
    const { app, consultaProjetos } = montar();

    const resposta = await app.inject({
      method: 'GET',
      url: '/projetos?produtorId=produtor-1&status=FINALIZADO&limite=5',
    });

    expect(resposta.statusCode).toBe(200);
    expect(consultaProjetos.listar).toHaveBeenCalledWith({
      produtorId: 'produtor-1',
      status: 'FINALIZADO',
      limite: 5,
    });
    await app.close();
  });

  it('recusa limite acima de 100 e status desconhecido com 400', async () => {
    const { app, consultaProjetos } = montar();

    const limite = await app.inject({ method: 'GET', url: '/projetos?limite=101' });
    const status = await app.inject({ method: 'GET', url: '/projetos?status=ARQUIVADO' });

    expect(limite.statusCode).toBe(400);
    expect(limite.json()).toMatchObject({ codigo: 'REQUISICAO_INVALIDA' });
    expect(status.statusCode).toBe(400);
    expect(consultaProjetos.listar).not.toHaveBeenCalled();
    await app.close();
  });
});

describe('ehIndisponibilidadeBanco', () => {
  it('reconhece códigos de rede, de desligamento do PostgreSQL e mensagens do pg', () => {
    expect(ehIndisponibilidadeBanco(Object.assign(new Error('x'), { code: '57P01' }))).toBe(true);
    expect(ehIndisponibilidadeBanco(new Error('timeout exceeded when trying to connect'))).toBe(
      true,
    );
    expect(ehIndisponibilidadeBanco(new Error('syntax error'))).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import type { Observador } from '../../../src/application/ports/observador.js';
import { carregarConfig } from '../../../src/config/config.js';
import { criarContainer } from '../../../src/container.js';
import { BarramentoEventosEmMemoria } from '../../../src/infrastructure/messaging/barramento-eventos-memoria.js';
import { eventoEquipeFormada, eventoRecomendacao } from '../../fixtures/eventos.js';

describe('BarramentoEventosEmMemoria', () => {
  it('ignora inscrição repetida e remoção de observador desconhecido', async () => {
    const barramento = new BarramentoEventosEmMemoria();
    let chamadas = 0;
    const observador: Observador = {
      nome: 'contador',
      interesses: ['RECOMENDACAO_GERADA'],
      atualizar: () => {
        chamadas += 1;
        return Promise.resolve();
      },
    };

    barramento.adicionarObservador(observador);
    barramento.adicionarObservador(observador);
    barramento.removerObservador({ ...observador });
    barramento.notificarObservadores(eventoRecomendacao());
    await barramento.aguardarEntregas();

    expect(chamadas).toBe(1);
    expect(barramento.observadores).toEqual(['contador']);
  });

  it('isola até um tratador de falhas que também falha', async () => {
    const barramento = new BarramentoEventosEmMemoria(() => {
      throw new Error('logger quebrado');
    });
    barramento.adicionarObservador({
      nome: 'falho',
      interesses: '*',
      atualizar: () => {
        throw new Error('erro síncrono');
      },
    });

    barramento.notificarObservadores(eventoRecomendacao());

    await expect(barramento.aguardarEntregas()).resolves.toBeUndefined();
  });
});

describe('criarContainer', () => {
  const config = carregarConfig({ NODE_ENV: 'test', DB_USER: 'u', DB_PASSWORD: 's', DB_NAME: 'b' });

  it('liga ao barramento só os observadores de produção, sem os notificadores genéricos', () => {
    const container = criarContainer(config);

    expect(container.barramento.observadores).toEqual([
      'auditoria-recomendacao',
      'atualizador-composicao',
      'encaminhador-eventos-projeto',
      'publicador-integracao',
    ]);
    expect(container.barramento.observadores).not.toContain('notificador-email');
    expect(container.barramento.observadores).not.toContain('notificador-interno');
  });

  it('publica só o tópico financeiro de equipe formada em produção', async () => {
    const container = criarContainer(config, undefined, { encaminhamento: { tentativas: 1 } });

    container.barramento.notificarObservadores(eventoEquipeFormada());
    await container.encerrar();

    expect(container.canais.publicador.publicadas.total).toBe(1);
    expect(container.canais.publicador.publicadas.todos[0]?.topico).toBe(
      'financeiro.equipe-formada',
    );
  });

  it('sem banco, registra no log os observadores que falharam e os demais seguem entregando', async () => {
    const container = criarContainer(config, undefined, { encaminhamento: { tentativas: 1 } });
    const falharam: string[] = [];
    container.logger.error = (dados: { observador?: string }) => {
      if (dados.observador) {
        falharam.push(dados.observador);
      }
    };
    container.barramento.adicionarObservador({
      nome: 'falho',
      interesses: '*',
      atualizar: () => Promise.reject(new Error('x')),
    });

    container.barramento.notificarObservadores(eventoRecomendacao());
    await container.encerrar();

    expect(falharam.sort()).toEqual([
      'auditoria-recomendacao',
      'encaminhador-eventos-projeto',
      'falho',
    ]);
  });
});

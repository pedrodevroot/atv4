import { describe, expect, it } from 'vitest';
import {
  TIPOS_EVENTO_API,
  type TipoEventoApi,
} from '../../../src/contratos/atualizacoes-projetos.js';
import type { MetricasProjeto } from '../../../src/contratos/eventos-projetos.js';
import {
  aplicarEvento,
  decidirTransicao,
  metricasIniciais,
  normalizarMetricas,
} from '../../../src/domain/ciclo-vida.js';
import { DADOS_EQUIPE_FORMADA, DADOS_RECOMENDACAO } from '../fixtures.js';

const INICIAIS = metricasIniciais();

const DADOS_POR_MOTIVO: Record<TipoEventoApi, Readonly<Record<string, unknown>>> = {
  RECOMENDACAO_GERADA: DADOS_RECOMENDACAO,
  SUBSTITUICAO_SOLICITADA: { equipeId: 'equipe-1', papel: 'DIRETOR' },
  SUBSTITUICAO_INDISPONIVEL: { equipeId: 'equipe-1', papel: 'DIRETOR', motivo: 'sem candidatos' },
  MEMBRO_REJEITADO: { equipeId: 'equipe-1', papel: 'DIRETOR', profissionalId: 'prof-1' },
  CONVITE_ENVIADO: { conviteId: 'convite-1' },
  CONVITE_ACEITO: { conviteId: 'convite-1' },
  CONVITE_RECUSADO: { conviteId: 'convite-1' },
  CONVITE_EXPIRADO: { conviteId: 'convite-1' },
  REAVALIACAO_SOLICITADA: { significativa: true },
  DETALHES_ATUALIZADOS: { detalhes: { titulo: 'Novo' } },
  EQUIPE_FORMADA: DADOS_EQUIPE_FORMADA,
  ARQUIVO_ANEXADO: { arquivoId: 'arquivo-1' },
  PAGAMENTO_EFETUADO: { pagamentoId: 'pag-1', valor: 4_000.5 },
  PAGAMENTO_CANCELADO: { pagamentoId: 'pag-1' },
};

const ESPERADO_POR_MOTIVO: Record<TipoEventoApi, Partial<MetricasProjeto>> = {
  RECOMENDACAO_GERADA: {
    rodadas: 1,
    ultimaEstrategia: 'filtragem-colaborativa',
    recomendacoesGeradas: 1,
    profissionaisRecomendados: 2,
  },
  SUBSTITUICAO_SOLICITADA: { substituicoes: 1 },
  SUBSTITUICAO_INDISPONIVEL: { substituicoesIndisponiveis: 1 },
  MEMBRO_REJEITADO: { membrosRejeitados: 1 },
  CONVITE_ENVIADO: { convites: { ...INICIAIS.convites, enviados: 1 } },
  CONVITE_ACEITO: { convites: { ...INICIAIS.convites, aceitos: 1 } },
  CONVITE_RECUSADO: { convites: { ...INICIAIS.convites, recusados: 1 } },
  CONVITE_EXPIRADO: { convites: { ...INICIAIS.convites, expirados: 1 } },
  REAVALIACAO_SOLICITADA: { reavaliacoes: 1 },
  DETALHES_ATUALIZADOS: {},
  EQUIPE_FORMADA: {
    equipeFormada: {
      equipeId: 'equipe-1',
      custoTotal: 12_000,
      membros: DADOS_EQUIPE_FORMADA.membros,
    },
  },
  ARQUIVO_ANEXADO: { arquivos: 1 },
  PAGAMENTO_EFETUADO: { pagamentos: { efetuados: 1, cancelados: 0, valorTotal: 4_000.5 } },
  PAGAMENTO_CANCELADO: { pagamentos: { efetuados: 0, cancelados: 1, valorTotal: 0 } },
};

describe('metricasIniciais', () => {
  it('começa com todos os contadores zerados e sem equipe formada', () => {
    expect(INICIAIS).toEqual({
      rodadas: 0,
      recomendacoesGeradas: 0,
      profissionaisRecomendados: 0,
      convites: { enviados: 0, aceitos: 0, recusados: 0, expirados: 0 },
      membrosRejeitados: 0,
      substituicoes: 0,
      substituicoesIndisponiveis: 0,
      reavaliacoes: 0,
      arquivos: 0,
      pagamentos: { efetuados: 0, cancelados: 0, valorTotal: 0 },
    });
  });
});

describe('aplicarEvento', () => {
  it.each(TIPOS_EVENTO_API)('aplica o efeito de %s sobre as métricas', (motivo) => {
    const resultado = aplicarEvento(INICIAIS, motivo, DADOS_POR_MOTIVO[motivo]);

    expect(resultado).toEqual({ ...INICIAIS, ...ESPERADO_POR_MOTIVO[motivo] });
  });

  it('é uma função pura: não altera as métricas recebidas', () => {
    const congeladas = Object.freeze({ ...INICIAIS, convites: Object.freeze(INICIAIS.convites) });

    aplicarEvento(congeladas, 'CONVITE_ENVIADO', {});

    expect(congeladas.convites.enviados).toBe(0);
  });

  it('acumula os contadores e soma os pagamentos em centavos exatos', () => {
    let metricas = INICIAIS;
    for (const valor of [0.1, 0.2, 100]) {
      metricas = aplicarEvento(metricas, 'PAGAMENTO_EFETUADO', { valor });
    }
    metricas = aplicarEvento(metricas, 'PAGAMENTO_EFETUADO', { valor: 'inválido' });

    expect(metricas.pagamentos).toEqual({ efetuados: 4, cancelados: 0, valorTotal: 100.3 });
  });

  it('guarda o maior número de rodada e só troca a estratégia por uma rodada igual ou mais nova', () => {
    const segunda = aplicarEvento(INICIAIS, 'RECOMENDACAO_GERADA', {
      ...DADOS_RECOMENDACAO,
      rodada: 2,
      estrategia: 'conteudo',
    });
    const atrasada = aplicarEvento(segunda, 'RECOMENDACAO_GERADA', {
      ...DADOS_RECOMENDACAO,
      rodada: 1,
      estrategia: 'antiga',
      profissionais: [],
    });

    expect(atrasada).toMatchObject({
      rodadas: 2,
      recomendacoesGeradas: 2,
      ultimaEstrategia: 'conteudo',
      profissionaisRecomendados: 2,
    });
  });

  it('lê os dados de forma defensiva quando a recomendação vem incompleta', () => {
    const resultado = aplicarEvento(INICIAIS, 'RECOMENDACAO_GERADA', { rodada: -3 });

    expect(resultado).toMatchObject({
      rodadas: 1,
      recomendacoesGeradas: 1,
      profissionaisRecomendados: 0,
    });
    expect(resultado.ultimaEstrategia).toBeUndefined();
  });

  it('ignora equipe formada sem identificador e descarta membros inválidos', () => {
    expect(aplicarEvento(INICIAIS, 'EQUIPE_FORMADA', { membros: [] })).toEqual(INICIAIS);

    const resultado = aplicarEvento(INICIAIS, 'EQUIPE_FORMADA', {
      equipeId: 'equipe-9',
      membros: [
        { papel: 'DIRETOR', profissionalId: 'prof-1', custo: 1_000 },
        { papel: 'EDITOR', profissionalId: '' },
        { papel: 'SONOPLASTA', profissionalId: 'prof-3' },
        'lixo',
      ],
    });

    expect(resultado.equipeFormada).toEqual({
      equipeId: 'equipe-9',
      custoTotal: 1_000,
      membros: [
        { papel: 'DIRETOR', profissionalId: 'prof-1', custo: 1_000 },
        { papel: 'SONOPLASTA', profissionalId: 'prof-3', custo: 0 },
      ],
    });
  });
});

describe('normalizarMetricas', () => {
  it('completa métricas antigas ou parciais vindas do banco', () => {
    expect(normalizarMetricas({ rodadas: 2, convites: { aceitos: 1 } })).toEqual({
      ...INICIAIS,
      rodadas: 2,
      convites: { ...INICIAIS.convites, aceitos: 1 },
    });
    expect(normalizarMetricas(null)).toEqual(INICIAIS);
    expect(normalizarMetricas([1, 2])).toEqual(INICIAIS);
  });

  it('preserva estratégia e equipe formada já gravadas', () => {
    const completas = aplicarEvento(
      aplicarEvento(INICIAIS, 'RECOMENDACAO_GERADA', DADOS_RECOMENDACAO),
      'EQUIPE_FORMADA',
      DADOS_EQUIPE_FORMADA,
    );

    expect(normalizarMetricas(JSON.parse(JSON.stringify(completas)))).toEqual(completas);
  });
});

describe('decidirTransicao', () => {
  it('registra o projeto novo como CRIADO e publica PROJETO_CRIADO', () => {
    expect(decidirTransicao(undefined, 'RECOMENDACAO_GERADA')).toEqual({
      status: 'CRIADO',
      tipoEventoSaida: 'PROJETO_CRIADO',
    });
  });

  it('registra como FINALIZADO o projeto que já chega com a equipe formada', () => {
    expect(decidirTransicao(undefined, 'EQUIPE_FORMADA')).toEqual({
      status: 'FINALIZADO',
      tipoEventoSaida: 'PROJETO_CRIADO',
    });
  });

  it('finaliza o projeto registrado quando a equipe é formada', () => {
    for (const status of ['CRIADO', 'EM_ANDAMENTO', 'FINALIZADO'] as const) {
      expect(decidirTransicao(status, 'EQUIPE_FORMADA')).toEqual({
        status: 'FINALIZADO',
        tipoEventoSaida: 'PROJETO_FINALIZADO',
      });
    }
  });

  it('passa a EM_ANDAMENTO nos demais motivos e mantém FINALIZADO como estado final', () => {
    expect(decidirTransicao('CRIADO', 'CONVITE_ENVIADO')).toEqual({
      status: 'EM_ANDAMENTO',
      tipoEventoSaida: 'PROJETO_ATUALIZADO',
    });
    expect(decidirTransicao('EM_ANDAMENTO', 'RECOMENDACAO_GERADA').status).toBe('EM_ANDAMENTO');
    expect(decidirTransicao('FINALIZADO', 'PAGAMENTO_EFETUADO')).toEqual({
      status: 'FINALIZADO',
      tipoEventoSaida: 'PROJETO_ATUALIZADO',
    });
  });
});

import type { Static } from 'typebox';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  type EsquemaEventoProjeto,
  STATUS_PROJETO,
  TIPOS_EVENTO_PROJETO,
  ehEventoProjeto,
  type EventoProjeto,
  type MetricasProjeto,
} from '../../../src/contratos/eventos-projetos.js';

function semCampo(objeto: object, campo: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(objeto).filter(([chave]) => chave !== campo));
}

const METRICAS: MetricasProjeto = {
  rodadas: 1,
  ultimaEstrategia: 'filtragem-colaborativa',
  recomendacoesGeradas: 1,
  profissionaisRecomendados: 3,
  convites: { enviados: 0, aceitos: 0, recusados: 0, expirados: 0 },
  membrosRejeitados: 0,
  substituicoes: 0,
  substituicoesIndisponiveis: 0,
  reavaliacoes: 0,
  arquivos: 0,
  pagamentos: { efetuados: 0, cancelados: 0, valorTotal: 0 },
};

const VALIDO: EventoProjeto = {
  id: 'saida-1',
  tipo: 'PROJETO_CRIADO',
  versao: 1,
  ocorridoEm: '2026-11-22T12:00:01.000Z',
  origem: 'cinebridge-projetos',
  correlacaoId: 'req-1',
  dados: {
    projeto: {
      id: 'projeto-1',
      titulo: 'Curta na Serra',
      produtorId: 'produtor-1',
      tipoCaptacao: 'FICCAO',
      genero: 'drama',
      duracaoMinutos: 20,
      orcamento: 80_000,
      dataInicio: '2027-02-01T00:00:00.000Z',
      dataEntrega: '2027-05-01T00:00:00.000Z',
      localizacao: { cidade: 'São José dos Campos', uf: 'SP' },
      estrategia: 'filtragem-colaborativa',
      requisitos: [{ papel: 'DIRETOR', peso: 1 }],
      status: 'CRIADO',
      metricas: METRICAS,
    },
    motivo: 'RECOMENDACAO_GERADA',
    eventoOrigemId: 'evento-1',
    detalhe: { profissionais: [{ profissionalId: 'prof-1', papel: 'DIRETOR', score: 0.9 }] },
  },
};

describe('contrato eventos-projetos', () => {
  it('define os três eventos e os três status do ciclo de vida', () => {
    expect(TIPOS_EVENTO_PROJETO).toEqual([
      'PROJETO_CRIADO',
      'PROJETO_ATUALIZADO',
      'PROJETO_FINALIZADO',
    ]);
    expect(STATUS_PROJETO).toEqual(['CRIADO', 'EM_ANDAMENTO', 'FINALIZADO']);
  });

  it('aceita cada tipo de evento e as métricas com equipe formada', () => {
    for (const tipo of TIPOS_EVENTO_PROJETO) {
      expect(ehEventoProjeto({ ...VALIDO, tipo })).toBe(true);
    }
    expect(
      ehEventoProjeto({
        ...VALIDO,
        tipo: 'PROJETO_FINALIZADO',
        dados: {
          ...VALIDO.dados,
          motivo: 'EQUIPE_FORMADA',
          projeto: {
            ...VALIDO.dados.projeto,
            status: 'FINALIZADO',
            metricas: {
              ...METRICAS,
              equipeFormada: {
                equipeId: 'equipe-1',
                custoTotal: 50_000,
                membros: [{ papel: 'DIRETOR', profissionalId: 'prof-1', custo: 50_000 }],
              },
            },
          },
        },
      }),
    ).toBe(true);
  });

  it('recusa sem id, com tipo desconhecido ou versão diferente de 1', () => {
    const semId = semCampo(VALIDO, 'id');

    expect(ehEventoProjeto(semId)).toBe(false);
    expect(ehEventoProjeto({ ...VALIDO, tipo: 'PROJETO_APAGADO' })).toBe(false);
    expect(ehEventoProjeto({ ...VALIDO, versao: 2 })).toBe(false);
  });

  it('recusa status, motivo ou métricas fora do contrato', () => {
    const projeto = VALIDO.dados.projeto;

    expect(
      ehEventoProjeto({
        ...VALIDO,
        dados: { ...VALIDO.dados, projeto: { ...projeto, status: 'X' } },
      }),
    ).toBe(false);
    expect(ehEventoProjeto({ ...VALIDO, dados: { ...VALIDO.dados, motivo: 'OUTRO' } })).toBe(false);
    expect(
      ehEventoProjeto({
        ...VALIDO,
        dados: { ...VALIDO.dados, projeto: { ...projeto, metricas: { ...METRICAS, rodadas: -1 } } },
      }),
    ).toBe(false);
  });

  it('o esquema de validação produz o tipo do contrato', () => {
    expectTypeOf<Static<typeof EsquemaEventoProjeto>>().toExtend<EventoProjeto>();
  });
});

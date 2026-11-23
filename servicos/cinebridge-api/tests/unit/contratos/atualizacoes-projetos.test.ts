import type { Static } from 'typebox';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  type EsquemaAtualizacaoProjeto,
  TIPOS_EVENTO_API,
  ehAtualizacaoProjeto,
  type AtualizacaoProjeto,
  type SnapshotProjeto,
} from '../../../src/contratos/atualizacoes-projetos.js';

function semCampo(objeto: object, campo: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(objeto).filter(([chave]) => chave !== campo));
}

const SNAPSHOT: SnapshotProjeto = {
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
};

const VALIDA: AtualizacaoProjeto = {
  id: 'evento-1',
  tipo: 'RECOMENDACAO_GERADA',
  versao: 1,
  ocorridoEm: '2026-11-22T12:00:00.000Z',
  origem: 'cinebridge-api',
  correlacaoId: 'req-1',
  dados: { projeto: SNAPSHOT, evento: { projetoId: 'projeto-1', rodada: 1, profissionais: [] } },
};

describe('contrato atualizacoes-projetos', () => {
  it('lista os 14 tipos de evento do api', () => {
    expect(TIPOS_EVENTO_API).toHaveLength(14);
    expect(new Set(TIPOS_EVENTO_API).size).toBe(14);
  });

  it('aceita uma atualização válida de cada tipo, com ou sem equipe formada', () => {
    for (const tipo of TIPOS_EVENTO_API) {
      expect(ehAtualizacaoProjeto({ ...VALIDA, tipo })).toBe(true);
    }
    expect(
      ehAtualizacaoProjeto({
        ...VALIDA,
        dados: { ...VALIDA.dados, projeto: { ...SNAPSHOT, equipeFormadaId: 'equipe-1' } },
      }),
    ).toBe(true);
  });

  it('recusa sem id, com tipo desconhecido ou versão diferente de 1', () => {
    const semId = semCampo(VALIDA, 'id');

    expect(ehAtualizacaoProjeto(semId)).toBe(false);
    expect(ehAtualizacaoProjeto({ ...VALIDA, tipo: 'PROJETO_APAGADO' })).toBe(false);
    expect(ehAtualizacaoProjeto({ ...VALIDA, versao: 2 })).toBe(false);
  });

  it('recusa snapshot incompleto ou evento que não é objeto', () => {
    const semTitulo = semCampo(SNAPSHOT, 'titulo');

    expect(
      ehAtualizacaoProjeto({ ...VALIDA, dados: { ...VALIDA.dados, projeto: semTitulo } }),
    ).toBe(false);
    expect(
      ehAtualizacaoProjeto({
        ...VALIDA,
        dados: {
          ...VALIDA.dados,
          projeto: { ...SNAPSHOT, localizacao: { cidade: 'X', uf: 'SPX' } },
        },
      }),
    ).toBe(false);
    expect(ehAtualizacaoProjeto({ ...VALIDA, dados: { ...VALIDA.dados, evento: [] } })).toBe(false);
    expect(ehAtualizacaoProjeto(null)).toBe(false);
  });

  it('o esquema de validação produz o tipo do contrato', () => {
    expectTypeOf<Static<typeof EsquemaAtualizacaoProjeto>>().toExtend<AtualizacaoProjeto>();
  });
});

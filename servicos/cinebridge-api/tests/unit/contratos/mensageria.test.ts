import Type from 'typebox';
import Value from 'typebox/value';
import { describe, expect, it } from 'vitest';
import {
  FILAS,
  OPCOES_FILA_DURAVEL,
  OPCOES_FILA_RESPOSTA,
  PREFIXO_FILA_RESPOSTA,
  VERSAO_CONTRATO,
  criarEnvelope,
  esquemaEnvelope,
} from '../../../src/contratos/mensageria.js';

function semCampo(objeto: object, campo: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(objeto).filter(([chave]) => chave !== campo));
}

const EsquemaTeste = esquemaEnvelope(Type.Literal('TESTE'), Type.Object({ valor: Type.Number() }));

describe('contrato comum da mensageria', () => {
  it('nomeia as filas e as opções de declaração com hífen, como no enunciado', () => {
    expect(FILAS).toEqual({
      CONSULTA_PROFISSIONAIS: 'consulta-profissionais',
      ATUALIZACOES_PROJETOS: 'atualizacoes-projetos',
      EVENTOS_PROJETOS: 'eventos-projetos',
    });
    expect(PREFIXO_FILA_RESPOSTA).toBe('consulta-profissionais.resposta.');
    expect(OPCOES_FILA_DURAVEL).toEqual({ durable: true });
    expect(OPCOES_FILA_RESPOSTA).toEqual({ durable: true, exclusive: true });
    expect(VERSAO_CONTRATO).toBe(1);
  });

  it('cria o envelope com id, data ISO e versão 1', () => {
    const envelope = criarEnvelope('TESTE', { valor: 1 }, 'cinebridge-api');

    expect(envelope).toEqual({
      id: expect.any(String) as string,
      tipo: 'TESTE',
      versao: 1,
      ocorridoEm: expect.any(String) as string,
      origem: 'cinebridge-api',
      dados: { valor: 1 },
    });
    expect(Number.isNaN(Date.parse(envelope.ocorridoEm))).toBe(false);
    expect(Value.Check(EsquemaTeste, envelope)).toBe(true);
  });

  it('respeita id, data e correlação informados', () => {
    const data = new Date('2026-11-22T12:00:00.000Z');

    expect(
      criarEnvelope('TESTE', { valor: 2 }, 'cinebridge-projetos', {
        id: 'evento-1',
        ocorridoEm: data,
        correlacaoId: 'req-1',
      }),
    ).toMatchObject({ id: 'evento-1', ocorridoEm: data.toISOString(), correlacaoId: 'req-1' });
    expect(
      criarEnvelope('TESTE', {}, 'cinebridge-profissionais', { ocorridoEm: '2026-01-01T00:00:00Z' })
        .ocorridoEm,
    ).toBe('2026-01-01T00:00:00Z');
  });

  it('recusa envelope sem id, com versão diferente de 1, origem ou data inválidas', () => {
    const valido = criarEnvelope('TESTE', { valor: 3 }, 'cinebridge-api');
    const semId = semCampo(valido, 'id');

    expect(Value.Check(EsquemaTeste, semId)).toBe(false);
    expect(Value.Check(EsquemaTeste, { ...valido, versao: 2 })).toBe(false);
    expect(Value.Check(EsquemaTeste, { ...valido, origem: 'outro-servico' })).toBe(false);
    expect(Value.Check(EsquemaTeste, { ...valido, ocorridoEm: 'ontem' })).toBe(false);
    expect(Value.Check(EsquemaTeste, { ...valido, id: 'x'.repeat(65) })).toBe(false);
    expect(Value.Check(EsquemaTeste, { ...valido, tipo: 'OUTRO' })).toBe(false);
  });
});

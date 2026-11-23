import { describe, expect, it } from 'vitest';
import { metricasIniciais } from '../../../../src/domain/ciclo-vida.js';
import {
  deLinhaEvento,
  deLinhaProjeto,
  paraIso,
  parametrosProjeto,
  type LinhaProjeto,
} from '../../../../src/infrastructure/banco/mapeador-projeto.js';
import { SNAPSHOT } from '../../fixtures.js';

const LINHA: LinhaProjeto = {
  id: 'projeto-1',
  titulo: 'Curta na Serra',
  produtor_id: 'produtor-1',
  tipo_captacao: 'FICCAO',
  genero: 'drama',
  duracao_minutos: 20,
  orcamento: '80000.00',
  data_inicio: new Date('2027-02-01T00:00:00.000Z'),
  data_entrega: '2027-05-01T00:00:00.000Z',
  cidade: 'São José dos Campos',
  uf: 'SP',
  estrategia: 'filtragem-colaborativa',
  requisitos: SNAPSHOT.requisitos,
  equipe_formada_id: null,
  status: 'CRIADO',
  metricas: {},
  criado_em: new Date('2026-11-22T12:00:00.000Z'),
  atualizado_em: new Date('2026-11-22T12:00:00.000Z'),
  finalizado_em: null,
};

describe('mapeador de projeto', () => {
  it('converte a linha do pg (numeric em texto, Date, jsonb) para o registro', () => {
    expect(deLinhaProjeto(LINHA)).toEqual({
      snapshot: SNAPSHOT,
      status: 'CRIADO',
      metricas: metricasIniciais(),
      criadoEm: '2026-11-22T12:00:00.000Z',
      atualizadoEm: '2026-11-22T12:00:00.000Z',
    });
  });

  it('lê de forma defensiva requisitos e status fora do esperado', () => {
    const registro = deLinhaProjeto({
      ...LINHA,
      requisitos: [{ papel: 'DIRETOR', peso: 1 }, { papel: 2 }, null, 'x'],
      status: 'DESCONHECIDO',
      equipe_formada_id: 'equipe-1',
      finalizado_em: '2026-11-23T00:00:00.000Z',
    });

    expect(registro.snapshot.requisitos).toEqual([{ papel: 'DIRETOR', peso: 1 }]);
    expect(registro.status).toBe('CRIADO');
    expect(registro.snapshot.equipeFormadaId).toBe('equipe-1');
    expect(registro.finalizadoEm).toBe('2026-11-23T00:00:00.000Z');
    expect(deLinhaProjeto({ ...LINHA, requisitos: 'quebrado' }).snapshot.requisitos).toEqual([]);
  });

  it('gera os 19 parâmetros na ordem das colunas, com jsonb serializado', () => {
    const parametros = parametrosProjeto(deLinhaProjeto(LINHA));

    expect(parametros).toHaveLength(19);
    expect(parametros[12]).toBe(JSON.stringify(SNAPSHOT.requisitos));
    expect(parametros[13]).toBeNull();
    expect(parametros[18]).toBeNull();
  });

  it('converte o evento recebido e normaliza tipo de saída desconhecido', () => {
    const evento = deLinhaEvento({
      evento_id: 'evento-1',
      tipo: 'CONVITE_ACEITO',
      ocorrido_em: '2026-11-22T12:00:00.000Z',
      recebido_em: new Date('2026-11-22T12:00:01.000Z'),
      correlacao_id: null,
      evento_saida_id: 'saida-1',
      evento_saida_tipo: 'OUTRO',
      publicado: true,
    });

    expect(evento).toEqual({
      eventoId: 'evento-1',
      tipo: 'CONVITE_ACEITO',
      ocorridoEm: '2026-11-22T12:00:00.000Z',
      recebidoEm: '2026-11-22T12:00:01.000Z',
      eventoSaida: { id: 'saida-1', tipo: 'PROJETO_ATUALIZADO' },
      publicado: true,
    });
    expect(paraIso('2026-11-22T09:00:00-03:00')).toBe('2026-11-22T12:00:00.000Z');
  });
});

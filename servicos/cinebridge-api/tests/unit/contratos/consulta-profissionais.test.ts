import type { Static } from 'typebox';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  type EsquemaConsultaProfissionais,
  type EsquemaRespostaProfissionais,
  OPERACOES_CONSULTA_PROFISSIONAIS,
  ehConsultaProfissionais,
  ehRespostaProfissionais,
  type ConsultaProfissionais,
  type ProfissionalCompletoRow,
  type RespostaProfissionais,
} from '../../../src/contratos/consulta-profissionais.js';

function semCampo(objeto: object, campo: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(objeto).filter(([chave]) => chave !== campo));
}

const PROFISSIONAL: ProfissionalCompletoRow = {
  id: 'prof-1',
  nome: 'Ana Souza',
  especialidades: ['DIRETOR'],
  preco_minimo: '1500.00',
  preco_maximo: 3000,
  cidade: 'São Paulo',
  uf: 'SP',
  latitude: -23.55,
  longitude: -46.63,
  ativo: true,
  nota_media: '4.50',
  total_avaliacoes: 1,
  competencias: [{ nome: 'direcao-de-atores', nivel: 5 }],
  avaliacoes: [
    {
      id: 'aval-1',
      nota: '4.5',
      comentario: 'Ótima direção',
      data: '2026-03-01T00:00:00+00:00',
      produtor_id: 'produtor-1',
      projeto_id: 'projeto-0',
      papel: 'DIRETOR',
      genero: 'drama',
      tipo_captacao: 'FICCAO',
    },
  ],
  historico: [
    {
      projeto_id: 'projeto-0',
      titulo: 'Longa',
      papel: 'DIRETOR',
      genero: 'drama',
      tipo_captacao: 'FICCAO',
      ano: 2025,
    },
  ],
  disponibilidades: [{ inicio: '2026-09-01T00:00:00+00:00', fim: '2027-12-31T00:00:00+00:00' }],
};

const CONSULTA: ConsultaProfissionais = {
  id: 'consulta-1',
  tipo: 'CONSULTA_PROFISSIONAIS',
  versao: 1,
  ocorridoEm: '2026-11-22T12:00:00.000Z',
  origem: 'cinebridge-api',
  dados: { operacao: 'listar-ativos' },
};

const RESPOSTA: RespostaProfissionais = {
  id: 'resposta-1',
  tipo: 'RESPOSTA_PROFISSIONAIS',
  versao: 1,
  ocorridoEm: '2026-11-22T12:00:00.100Z',
  origem: 'cinebridge-profissionais',
  correlacaoId: 'consulta-1',
  dados: { sucesso: true, profissionais: [PROFISSIONAL] },
};

describe('contrato consulta-profissionais: consulta', () => {
  it('aceita as duas operações', () => {
    expect(OPERACOES_CONSULTA_PROFISSIONAIS).toEqual(['listar-ativos', 'obter-por-ids']);
    expect(ehConsultaProfissionais(CONSULTA)).toBe(true);
    expect(
      ehConsultaProfissionais({
        ...CONSULTA,
        dados: { operacao: 'obter-por-ids', ids: ['prof-1'] },
      }),
    ).toBe(true);
  });

  it('recusa sem id, com tipo desconhecido ou versão diferente de 1', () => {
    const semId = semCampo(CONSULTA, 'id');

    expect(ehConsultaProfissionais(semId)).toBe(false);
    expect(ehConsultaProfissionais({ ...CONSULTA, tipo: 'RESPOSTA_PROFISSIONAIS' })).toBe(false);
    expect(ehConsultaProfissionais({ ...CONSULTA, versao: 2 })).toBe(false);
  });

  it('recusa operação desconhecida e obter-por-ids sem a lista de ids', () => {
    expect(ehConsultaProfissionais({ ...CONSULTA, dados: { operacao: 'apagar-todos' } })).toBe(
      false,
    );
    expect(ehConsultaProfissionais({ ...CONSULTA, dados: { operacao: 'obter-por-ids' } })).toBe(
      false,
    );
    expect(
      ehConsultaProfissionais({ ...CONSULTA, dados: { operacao: 'obter-por-ids', ids: [''] } }),
    ).toBe(false);
  });
});

describe('contrato consulta-profissionais: resposta', () => {
  it('aceita sucesso com perfis numéricos em texto ou número e a resposta de erro', () => {
    expect(ehRespostaProfissionais(RESPOSTA)).toBe(true);
    expect(
      ehRespostaProfissionais({
        ...RESPOSTA,
        dados: { sucesso: false, erro: { codigo: 'ERRO_BANCO', mensagem: 'Banco fora do ar' } },
      }),
    ).toBe(true);
  });

  it('recusa sem id, com tipo desconhecido ou versão diferente de 1', () => {
    const semId = semCampo(RESPOSTA, 'id');

    expect(ehRespostaProfissionais(semId)).toBe(false);
    expect(ehRespostaProfissionais({ ...RESPOSTA, tipo: 'CONSULTA_PROFISSIONAIS' })).toBe(false);
    expect(ehRespostaProfissionais({ ...RESPOSTA, versao: 2 })).toBe(false);
  });

  it('recusa perfil incompleto, preço que não é número e erro sem código', () => {
    const semCompetencias = semCampo(PROFISSIONAL, 'competencias');

    expect(
      ehRespostaProfissionais({
        ...RESPOSTA,
        dados: { sucesso: true, profissionais: [semCompetencias] },
      }),
    ).toBe(false);
    expect(
      ehRespostaProfissionais({
        ...RESPOSTA,
        dados: { sucesso: true, profissionais: [{ ...PROFISSIONAL, preco_minimo: 'barato' }] },
      }),
    ).toBe(false);
    expect(
      ehRespostaProfissionais({
        ...RESPOSTA,
        dados: { sucesso: false, erro: { codigo: '', mensagem: 'x' } },
      }),
    ).toBe(false);
  });

  it('os esquemas de validação produzem os tipos do contrato', () => {
    expectTypeOf<Static<typeof EsquemaConsultaProfissionais>>().toExtend<ConsultaProfissionais>();
    expectTypeOf<Static<typeof EsquemaRespostaProfissionais>>().toExtend<RespostaProfissionais>();
  });
});

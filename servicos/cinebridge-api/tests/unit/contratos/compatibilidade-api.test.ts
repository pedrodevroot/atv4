import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  TIPOS_EVENTO_API,
  type TipoEventoApi,
} from '../../../src/contratos/atualizacoes-projetos.js';
import type { ProfissionalCompletoRow as ProfissionalDoContrato } from '../../../src/contratos/consulta-profissionais.js';
import { TIPOS_EVENTO, type TipoEvento } from '../../../src/domain/eventos/evento-recomendacao.js';
import {
  paraProfissional,
  type ProfissionalCompletoRow as ProfissionalDoBanco,
} from '../../../src/infrastructure/database/mapeadores.js';

describe('contratos de mensageria x domínio do api', () => {
  it('os tipos de evento do contrato são os mesmos eventos de domínio do api', () => {
    expect([...TIPOS_EVENTO_API]).toEqual([...TIPOS_EVENTO]);
    expectTypeOf<TipoEventoApi>().toEqualTypeOf<TipoEvento>();
  });

  it('o perfil da resposta tem o formato que o api já converte com paraProfissional', () => {
    expectTypeOf<ProfissionalDoContrato>().toExtend<ProfissionalDoBanco>();
    expectTypeOf<ProfissionalDoBanco>().toExtend<ProfissionalDoContrato>();

    const perfil: ProfissionalDoContrato = {
      id: 'prof-1',
      nome: 'Ana Souza',
      especialidades: ['DIRETOR'],
      preco_minimo: '1500.00',
      preco_maximo: '3000.00',
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
      historico: [],
      disponibilidades: [{ inicio: '2026-09-01T00:00:00+00:00', fim: '2027-12-31T00:00:00+00:00' }],
    };

    const profissional = paraProfissional(perfil);

    expect(profissional.id).toBe('prof-1');
    expect(profissional.faixaPreco.minimo).toBe(1500);
  });
});

import { describe, expect, it } from 'vitest';
import { ParticipacaoProjeto } from '../../../src/domain/entidades/participacao-projeto.js';
import { Papel } from '../../../src/domain/enums/papel.js';
import { TipoCaptacao } from '../../../src/domain/enums/tipo-captacao.js';
import {
  deProfissionalCompleto,
  deProjeto,
  paraProfissional,
  paraProjeto,
  type ProfissionalCompletoRow,
} from '../../../src/infrastructure/database/mapeadores.js';
import {
  criarAvaliacao,
  criarEquipe,
  criarMembro,
  criarProfissional,
  criarProjeto,
} from '../../fixtures/dominio.js';
import { fabricasTeste } from '../../fixtures/fabricas.js';

function profissionalCompleto() {
  return criarProfissional({
    id: 'prof-congelado',
    especialidades: [Papel.DIRETOR, Papel.ROTEIRISTA],
    avaliacoes: [
      criarAvaliacao({ id: 'aval-1', nota: 4.5, comentario: 'Ótima direção' }),
      criarAvaliacao({ id: 'aval-2', nota: 3 }),
    ],
    historico: [
      ParticipacaoProjeto.criar({
        projetoId: 'projeto-antigo',
        titulo: 'Curta de estreia',
        papel: Papel.DIRETOR,
        genero: 'drama',
        tipoCaptacao: TipoCaptacao.FICCAO,
        ano: 2024,
      }),
    ],
  });
}

describe('perfil congelado do profissional em membro_equipe', () => {
  it('grava o perfil no formato ProfissionalCompletoRow, com datas em ISO', () => {
    const linha = deProfissionalCompleto(profissionalCompleto());

    expect(linha).toMatchObject({
      id: 'prof-congelado',
      especialidades: [Papel.DIRETOR, Papel.ROTEIRISTA],
      preco_minimo: 10_000,
      preco_maximo: 20_000,
      nota_media: 3.75,
      total_avaliacoes: 2,
      competencias: [
        { nome: 'direção de atores', nivel: 5 },
        { nome: 'roteiro', nivel: 3 },
      ],
      historico: [{ projeto_id: 'projeto-antigo', ano: 2024, tipo_captacao: 'FICCAO' }],
    });
    expect(linha.avaliacoes[0]).toMatchObject({ id: 'aval-1', data: '2025-06-01T00:00:00.000Z' });
    expect(linha.disponibilidades[0]?.inicio).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it('volta igual depois de passar por JSON, como acontece no jsonb', () => {
    const original = profissionalCompleto();
    const linha = JSON.parse(
      JSON.stringify(deProfissionalCompleto(original)),
    ) as ProfissionalCompletoRow;

    expect(paraProfissional(linha)).toEqual(original);
  });

  it('cada membro da equipe leva o perfil e o projeto é remontado sem consultar o cadastro', () => {
    const profissional = profissionalCompleto();
    const projeto = criarProjeto();
    projeto.registrarSugestoes([
      criarEquipe(projeto, { membros: [criarMembro(Papel.DIRETOR, { profissional })] }),
    ]);

    const linhas = deProjeto(projeto);
    const lidas = JSON.parse(JSON.stringify(linhas)) as typeof linhas;
    const perfis = new Map(
      lidas.membros.map((membro) => [
        membro.profissional_id,
        paraProfissional(membro.profissional),
      ]),
    );
    const remontado = paraProjeto(
      {
        projeto: { ...linhas.projeto },
        equipes: linhas.equipes,
        membros: lidas.membros,
      },
      perfis,
      fabricasTeste,
    );

    expect(linhas.membros[0]?.profissional).toEqual(deProfissionalCompleto(profissional));
    expect(remontado.equipes[0]?.membros[0]?.profissional).toEqual(profissional);
  });
});

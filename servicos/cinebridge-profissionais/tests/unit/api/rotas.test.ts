import { describe, expect, it, vi } from 'vitest';
import { construirApp } from '../../../src/app.js';
import { ConsultarSaude } from '../../../src/application/consultar-saude.js';
import type {
  CadastroProfissionais,
  ResumoProfissional,
} from '../../../src/application/ports/cadastro-profissionais.js';
import { criarLinhaCompleta } from '../helpers-cadastro.js';

const RESUMO: ResumoProfissional = {
  id: 'p1',
  nome: 'Ana Souza',
  especialidades: ['DIRETOR'],
  preco_minimo: '15000.00',
  preco_maximo: '21000.00',
  cidade: 'São Paulo',
  uf: 'SP',
  ativo: true,
  nota_media: '4.50',
  total_avaliacoes: 3,
};

function criarApp() {
  const cadastro = {
    listarAtivos: vi.fn(() => Promise.resolve([])),
    obterPorIds: vi.fn(() => Promise.resolve([])),
    obterPorId: vi.fn((id: string) =>
      Promise.resolve(id === 'p1' ? criarLinhaCompleta('p1') : undefined),
    ),
    listarResumo: vi.fn(() => Promise.resolve([RESUMO])),
  } satisfies CadastroProfissionais;
  const saude = new ConsultarSaude([{ nome: 'postgres', verificar: () => Promise.resolve(true) }]);
  return { app: construirApp({ consultarSaude: saude, cadastro }), cadastro };
}

describe('GET /profissionais', () => {
  it('lista com limite padrão 20 e converte os números', async () => {
    const { app, cadastro } = criarApp();

    const resposta = await app.inject({ method: 'GET', url: '/profissionais' });

    expect(resposta.statusCode).toBe(200);
    expect(cadastro.listarResumo).toHaveBeenCalledWith(undefined, 20);
    expect(resposta.json()).toEqual({
      quantidade: 1,
      profissionais: [
        {
          id: 'p1',
          nome: 'Ana Souza',
          especialidades: ['DIRETOR'],
          precoMinimo: 15000,
          precoMaximo: 21000,
          cidade: 'São Paulo',
          uf: 'SP',
          ativo: true,
          notaMedia: 4.5,
          totalAvaliacoes: 3,
        },
      ],
    });
    await app.close();
  });

  it('aceita papel e limite na consulta', async () => {
    const { app, cadastro } = criarApp();

    const resposta = await app.inject({
      method: 'GET',
      url: '/profissionais?papel=DIRETOR&limite=100',
    });

    expect(resposta.statusCode).toBe(200);
    expect(cadastro.listarResumo).toHaveBeenCalledWith('DIRETOR', 100);
    await app.close();
  });

  it.each(['limite=101', 'limite=0', 'limite=abc', 'papel=PADEIRO'])(
    'recusa a consulta inválida (%s) com 400',
    async (consulta) => {
      const { app, cadastro } = criarApp();

      const resposta = await app.inject({ method: 'GET', url: `/profissionais?${consulta}` });

      expect(resposta.statusCode).toBe(400);
      expect(cadastro.listarResumo).not.toHaveBeenCalled();
      await app.close();
    },
  );
});

describe('GET /profissionais/:id', () => {
  it('devolve o perfil completo em camelCase', async () => {
    const { app } = criarApp();

    const resposta = await app.inject({ method: 'GET', url: '/profissionais/p1' });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toMatchObject({
      id: 'p1',
      precoMinimo: 15000,
      notaMedia: 4.25,
      competencias: [{ nome: 'roteiro', nivel: 4 }],
      avaliacoes: [{ nota: 4, produtorId: 'produtor-1', tipoCaptacao: 'FICCAO' }],
      historico: [{ projetoId: 'projeto-1', ano: 2024 }],
      disponibilidades: [{ inicio: '2026-09-01T00:00:00+00:00' }],
    });
    await app.close();
  });

  it('responde 404 quando não existe', async () => {
    const { app } = criarApp();

    const resposta = await app.inject({ method: 'GET', url: '/profissionais/zzz' });

    expect(resposta.statusCode).toBe(404);
    expect(resposta.json()).toEqual({
      erro: { codigo: 'PROFISSIONAL_NAO_ENCONTRADO', mensagem: 'Profissional não encontrado' },
    });
    await app.close();
  });
});

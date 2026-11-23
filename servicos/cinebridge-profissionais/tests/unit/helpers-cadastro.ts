import type { ProfissionalCompletoRow } from '../../src/contratos/consulta-profissionais.js';
import type { LinhasCadastro } from '../../src/infrastructure/banco/linhas-cadastro.js';

export function criarLinhaCompleta(
  id: string,
  extras: Partial<ProfissionalCompletoRow> = {},
): ProfissionalCompletoRow {
  return {
    id,
    nome: `Profissional ${id}`,
    especialidades: ['DIRETOR'],
    preco_minimo: '15000.00',
    preco_maximo: '21000.00',
    cidade: 'São Paulo',
    uf: 'SP',
    latitude: -23.55,
    longitude: -46.63,
    ativo: true,
    nota_media: '4.25',
    total_avaliacoes: 2,
    competencias: [{ nome: 'roteiro', nivel: 4 }],
    avaliacoes: [
      {
        id: `${id}-a1`,
        nota: '4.0',
        comentario: 'Ótima entrega.',
        data: '2025-03-01T10:00:00+00:00',
        produtor_id: 'produtor-1',
        projeto_id: 'projeto-1',
        papel: 'DIRETOR',
        genero: 'drama',
        tipo_captacao: 'FICCAO',
      },
    ],
    historico: [
      {
        projeto_id: 'projeto-1',
        titulo: 'Curta',
        papel: 'DIRETOR',
        genero: 'drama',
        tipo_captacao: 'FICCAO',
        ano: 2024,
      },
    ],
    disponibilidades: [{ inicio: '2026-09-01T00:00:00+00:00', fim: '2027-12-31T00:00:00+00:00' }],
    ...extras,
  };
}

export function paraLinhaCompleta(linha: LinhasCadastro): ProfissionalCompletoRow {
  return {
    ...linha.profissional,
    competencias: linha.competencias.map((c) => ({ nome: c.nome, nivel: c.nivel })),
    avaliacoes: linha.avaliacoes.map((a) => ({
      id: a.id,
      nota: a.nota.toFixed(1),
      comentario: a.comentario,
      data: a.data.toISOString(),
      produtor_id: a.produtor_id,
      projeto_id: a.projeto_id,
      papel: a.papel,
      genero: a.genero,
      tipo_captacao: a.tipo_captacao,
    })),
    historico: linha.historico.map((h) => ({
      projeto_id: h.projeto_id,
      titulo: h.titulo,
      papel: h.papel,
      genero: h.genero,
      tipo_captacao: h.tipo_captacao,
      ano: h.ano,
    })),
    disponibilidades: linha.disponibilidades.map((d) => ({
      inicio: d.inicio.toISOString(),
      fim: d.fim.toISOString(),
    })),
  };
}

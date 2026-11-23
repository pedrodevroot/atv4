import { describe, expect, it } from 'vitest';
import { ehRespostaProfissionais } from '../../../../src/contratos/consulta-profissionais.js';
import { criarEnvelope } from '../../../../src/contratos/mensageria.js';
import {
  COMPETENCIAS_POR_PAPEL,
  PAPEIS,
  TIPOS_CAPTACAO,
  ehPapel,
} from '../../../../src/domain/catalogo.js';
import {
  FIM_AGENDA,
  INICIO_AGENDA,
  gerarCadastro,
} from '../../../../src/infrastructure/banco/gerador-cadastro.js';
import { paraLinhaCompleta } from '../../helpers-cadastro.js';

describe('gerarCadastro', () => {
  it('é determinístico para a mesma semente e muda com outra', () => {
    const primeiro = gerarCadastro(40, 2026);
    const segundo = gerarCadastro(40, 2026);
    const outro = gerarCadastro(40, 99);

    expect(segundo).toEqual(primeiro);
    expect(outro.map((linha) => linha.profissional.id)).not.toEqual(
      primeiro.map((linha) => linha.profissional.id),
    );
  });

  it('gera a quantidade pedida, com ids únicos e papéis em rodízio', () => {
    const cadastro = gerarCadastro(300, 1);

    expect(cadastro).toHaveLength(300);
    expect(new Set(cadastro.map((linha) => linha.profissional.id)).size).toBe(300);
    cadastro.forEach((linha, indice) => {
      expect(linha.profissional.especialidades[0]).toBe(PAPEIS[indice % PAPEIS.length]);
    });
    expect(gerarCadastro(0)).toEqual([]);
  });

  it('respeita as restrições CHECK do banco em todas as tabelas', () => {
    for (const linha of gerarCadastro(600, 3)) {
      const p = linha.profissional;
      expect(p.especialidades.length).toBeGreaterThan(0);
      expect(new Set(p.especialidades).size).toBe(p.especialidades.length);
      expect(p.preco_minimo).toBeGreaterThan(0);
      expect(p.preco_maximo).toBeGreaterThanOrEqual(p.preco_minimo);
      expect(p.uf).toHaveLength(2);
      expect(Math.abs(p.latitude)).toBeLessThanOrEqual(90);
      expect(Math.abs(p.longitude)).toBeLessThanOrEqual(180);
      expect(p.nome.length).toBeGreaterThan(0);
      expect(p.nome.length).toBeLessThanOrEqual(200);
      expect(p.nota_media).toBeGreaterThanOrEqual(0);
      expect(p.nota_media).toBeLessThanOrEqual(5);
      expect(p.total_avaliacoes).toBe(linha.avaliacoes.length);

      for (const competencia of linha.competencias) {
        expect(competencia.nivel).toBeGreaterThanOrEqual(1);
        expect(competencia.nivel).toBeLessThanOrEqual(5);
        expect(competencia.profissional_id).toBe(p.id);
      }
      for (const avaliacao of linha.avaliacoes) {
        expect(Number.isInteger(avaliacao.nota)).toBe(true);
        expect(avaliacao.nota).toBeGreaterThanOrEqual(1);
        expect(avaliacao.nota).toBeLessThanOrEqual(5);
        expect(avaliacao.profissional_id).toBe(p.id);
        expect(TIPOS_CAPTACAO as readonly string[]).toContain(avaliacao.tipo_captacao);
        expect(ehPapel(avaliacao.papel)).toBe(true);
      }
      for (const participacao of linha.historico) {
        expect(participacao.titulo.trim().length).toBeGreaterThan(0);
        expect(participacao.ano).toBeGreaterThanOrEqual(2010);
      }
      expect(linha.disponibilidades.length).toBeGreaterThan(0);
      for (const disponibilidade of linha.disponibilidades) {
        expect(disponibilidade.inicio.getTime()).toBeLessThanOrEqual(disponibilidade.fim.getTime());
        expect(disponibilidade.inicio.getTime()).toBeGreaterThanOrEqual(INICIO_AGENDA.getTime());
        expect(disponibilidade.fim.getTime()).toBeLessThanOrEqual(FIM_AGENDA.getTime());
      }
    }
  });

  it('calcula nota_media como a média arredondada em duas casas', () => {
    for (const linha of gerarCadastro(200, 5)) {
      const notas = linha.avaliacoes.map((avaliacao) => avaliacao.nota);
      const esperado =
        notas.length === 0
          ? 0
          : Math.round((notas.reduce((a, b) => a + b, 0) / notas.length) * 100) / 100;
      expect(linha.profissional.nota_media).toBe(esperado);
    }
  });

  it('usa só competências do catálogo do Apêndice A', () => {
    const catalogo = new Set(PAPEIS.flatMap((papel) => COMPETENCIAS_POR_PAPEL[papel]));
    for (const linha of gerarCadastro(120, 8)) {
      for (const competencia of linha.competencias) {
        expect(catalogo.has(competencia.nome)).toBe(true);
      }
    }
  });

  it('produz linhas que, no formato do banco, cabem no contrato da resposta', () => {
    const resposta = criarEnvelope(
      'RESPOSTA_PROFISSIONAIS',
      { sucesso: true as const, profissionais: gerarCadastro(50, 11).map(paraLinhaCompleta) },
      'cinebridge-profissionais',
    );

    expect(ehRespostaProfissionais(JSON.parse(JSON.stringify(resposta)))).toBe(true);
  });

  it('gera 10 mil perfis em tempo razoável', () => {
    const inicio = performance.now();
    const cadastro = gerarCadastro(10_000, 2026);

    expect(cadastro).toHaveLength(10_000);
    expect(performance.now() - inicio).toBeLessThan(20_000);
  }, 60_000);
});

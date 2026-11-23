import { Faker, base, pt_BR } from '@faker-js/faker';
import {
  COMPETENCIAS_POR_PAPEL,
  PAPEIS,
  TIPOS_CAPTACAO,
  TODAS_COMPETENCIAS,
  type Papel,
} from '../../domain/catalogo.js';
import type { LinhaDisponibilidade, LinhasCadastro } from './linhas-cadastro.js';

export const CIDADES = [
  { cidade: 'São Paulo', uf: 'SP', latitude: -23.5505, longitude: -46.6333 },
  { cidade: 'Rio de Janeiro', uf: 'RJ', latitude: -22.9068, longitude: -43.1729 },
  { cidade: 'Belo Horizonte', uf: 'MG', latitude: -19.9167, longitude: -43.9345 },
  { cidade: 'Porto Alegre', uf: 'RS', latitude: -30.0346, longitude: -51.2177 },
  { cidade: 'Salvador', uf: 'BA', latitude: -12.9777, longitude: -38.5016 },
  { cidade: 'Recife', uf: 'PE', latitude: -8.0476, longitude: -34.877 },
  { cidade: 'Fortaleza', uf: 'CE', latitude: -3.7319, longitude: -38.5267 },
  { cidade: 'Curitiba', uf: 'PR', latitude: -25.4284, longitude: -49.2733 },
  { cidade: 'Brasília', uf: 'DF', latitude: -15.7939, longitude: -47.8828 },
  { cidade: 'Manaus', uf: 'AM', latitude: -3.119, longitude: -60.0217 },
  { cidade: 'Belém', uf: 'PA', latitude: -1.4558, longitude: -48.4902 },
  { cidade: 'Florianópolis', uf: 'SC', latitude: -27.5954, longitude: -48.548 },
  { cidade: 'Goiânia', uf: 'GO', latitude: -16.6869, longitude: -49.2648 },
  { cidade: 'São José dos Campos', uf: 'SP', latitude: -23.1896, longitude: -45.8841 },
  { cidade: 'Campinas', uf: 'SP', latitude: -22.9099, longitude: -47.0626 },
] as const;

export const GENEROS = [
  'drama',
  'comédia',
  'suspense',
  'terror',
  'romance',
  'ficção científica',
  'social',
  'biografia',
  'musical',
  'infantil',
] as const;

export const PRECO_POR_PAPEL: Readonly<Record<Papel, readonly [number, number]>> = {
  DIRETOR: [15_000, 80_000],
  DIRETOR_FOTOGRAFIA: [10_000, 50_000],
  SONOPLASTA: [4_000, 25_000],
  EDITOR: [6_000, 35_000],
  ROTEIRISTA: [8_000, 40_000],
  EFEITOS_VISUAIS: [8_000, 45_000],
};

export const INICIO_AGENDA = new Date('2026-09-01T00:00:00.000Z');
export const FIM_AGENDA = new Date('2027-12-31T00:00:00.000Z');

const COMENTARIOS = ['', 'Pontual e criativo.', 'Ótima entrega.', 'Precisou de ajustes.'] as const;
const MS_POR_DIA = 86_400_000;

export function gerarCadastro(total: number, semente = 2026): LinhasCadastro[] {
  const faker = new Faker({ locale: [pt_BR, base] });
  faker.seed(semente);
  const inteiro = (min: number, max: number) => faker.number.int({ min, max });
  const nivel = (qualidade: number) =>
    Math.min(5, Math.max(1, Math.round(qualidade * 5 + faker.number.float({ min: -1, max: 1 }))));

  return Array.from({ length: total }, (_, indice) => {
    const id = faker.string.uuid();
    const papel = PAPEIS[indice % PAPEIS.length] ?? 'DIRETOR';
    const especialidades: Papel[] = faker.datatype.boolean({ probability: 0.2 })
      ? [papel, faker.helpers.arrayElement(PAPEIS.filter((outro) => outro !== papel))]
      : [papel];
    const qualidade = faker.number.float({ min: 0.2, max: 1 });
    const cidade = faker.helpers.arrayElement(CIDADES);
    const [precoBase, precoTeto] = PRECO_POR_PAPEL[papel];
    const minimo = Math.round(inteiro(precoBase, precoTeto * 0.7) / 100) * 100;
    const maximo = Math.round((minimo * faker.number.float({ min: 1.1, max: 1.6 })) / 100) * 100;
    const nome = faker.person.fullName();

    const competencias = [
      ...faker.helpers
        .arrayElements(COMPETENCIAS_POR_PAPEL[papel], { min: 3, max: 5 })
        .map((nomeCompetencia) => ({
          profissional_id: id,
          nome: nomeCompetencia,
          nivel: nivel(qualidade),
        })),
      ...faker.helpers
        .arrayElements(TODAS_COMPETENCIAS, { min: 0, max: 2 })
        .map((nomeCompetencia) => ({
          profissional_id: id,
          nome: nomeCompetencia,
          nivel: inteiro(1, 3),
        })),
    ];

    const avaliacoes = Array.from({ length: inteiro(0, 12) }, () => ({
      id: faker.string.uuid(),
      profissional_id: id,
      nota: Math.min(
        5,
        Math.max(1, Math.round(1 + qualidade * 4 + faker.number.float({ min: -1.5, max: 1 }))),
      ),
      comentario: faker.helpers.arrayElement(COMENTARIOS),
      data: faker.date.between({ from: '2019-01-01', to: '2026-08-31' }),
      produtor_id: `produtor-${inteiro(1, 300)}`,
      projeto_id: faker.string.uuid(),
      papel: faker.helpers.arrayElement(especialidades),
      genero: faker.helpers.arrayElement(GENEROS),
      tipo_captacao: faker.helpers.arrayElement(TIPOS_CAPTACAO),
    }));

    const historico = Array.from({ length: inteiro(0, 10) }, () => ({
      profissional_id: id,
      projeto_id: faker.string.uuid(),
      titulo: faker.lorem.words({ min: 2, max: 4 }),
      papel: faker.helpers.arrayElement(especialidades),
      genero: faker.helpers.arrayElement(GENEROS),
      tipo_captacao: faker.helpers.arrayElement(TIPOS_CAPTACAO),
      ano: inteiro(2010, 2026),
    }));

    const somaNotas = avaliacoes.reduce((soma, avaliacao) => soma + avaliacao.nota, 0);
    const notaMedia =
      avaliacoes.length === 0 ? 0 : Math.round((somaNotas / avaliacoes.length) * 100) / 100;

    const disponibilidades = gerarAgenda(faker, id);
    const latitude = cidade.latitude + faker.number.float({ min: -0.05, max: 0.05 });
    const longitude = cidade.longitude + faker.number.float({ min: -0.05, max: 0.05 });
    const ativo = faker.datatype.boolean({ probability: 0.95 });

    return {
      profissional: {
        id,
        nome,
        especialidades,
        preco_minimo: minimo,
        preco_maximo: Math.max(minimo, maximo),
        cidade: cidade.cidade,
        uf: cidade.uf,
        latitude,
        longitude,
        ativo,
        nota_media: notaMedia,
        total_avaliacoes: avaliacoes.length,
      },
      competencias,
      avaliacoes,
      historico,
      disponibilidades,
    };
  });
}

function gerarAgenda(faker: Faker, profissionalId: string): LinhaDisponibilidade[] {
  if (faker.datatype.boolean({ probability: 0.75 })) {
    return [{ profissional_id: profissionalId, inicio: INICIO_AGENDA, fim: FIM_AGENDA }];
  }
  const inicioLacuna = faker.date.between({ from: INICIO_AGENDA, to: '2027-06-30' });
  const fimLacuna = new Date(
    inicioLacuna.getTime() + faker.number.int({ min: 15, max: 120 }) * MS_POR_DIA,
  );
  return [
    { profissional_id: profissionalId, inicio: INICIO_AGENDA, fim: inicioLacuna },
    { profissional_id: profissionalId, inicio: fimLacuna, fim: FIM_AGENDA },
  ];
}

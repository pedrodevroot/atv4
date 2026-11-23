export const PAPEIS = [
  'DIRETOR',
  'DIRETOR_FOTOGRAFIA',
  'SONOPLASTA',
  'EDITOR',
  'ROTEIRISTA',
  'EFEITOS_VISUAIS',
] as const;

export type Papel = (typeof PAPEIS)[number];

export const TIPOS_CAPTACAO = ['DOCUMENTARIO', 'FICCAO', 'ANIMACAO', 'PUBLICITARIO'] as const;

export type TipoCaptacao = (typeof TIPOS_CAPTACAO)[number];

export const COMPETENCIAS_POR_PAPEL: Readonly<Record<Papel, readonly string[]>> = {
  DIRETOR: [
    'direcao-de-atores',
    'decupagem',
    'lideranca',
    'roteiro',
    'entrevista',
    'pesquisa',
    'animacao',
  ],
  DIRETOR_FOTOGRAFIA: ['fotografia', 'iluminacao', 'operacao-de-camera', 'color-grading'],
  SONOPLASTA: ['captacao-de-som', 'mixagem', 'desenho-de-som', 'trilha-sonora'],
  EDITOR: ['montagem', 'edicao-nao-linear', 'ritmo-narrativo', 'color-grading'],
  ROTEIRISTA: ['roteiro', 'dramaturgia', 'dialogos', 'pesquisa'],
  EFEITOS_VISUAIS: ['composicao-digital', 'rastreamento', 'modelagem-3d', 'animacao'],
};

export const TODAS_COMPETENCIAS: readonly string[] = [
  ...new Set(PAPEIS.flatMap((papel) => COMPETENCIAS_POR_PAPEL[papel])),
];

export function ehPapel(valor: string): valor is Papel {
  return (PAPEIS as readonly string[]).includes(valor);
}

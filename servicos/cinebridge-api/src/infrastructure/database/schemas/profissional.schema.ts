export type Numerico = number | string;

export interface ProfissionalRow {
  id: string;
  nome: string;
  especialidades: string[];
  preco_minimo: number;
  preco_maximo: number;
  cidade: string;
  uf: string;
  latitude: number;
  longitude: number;
  ativo: boolean;
  nota_media: number;
  total_avaliacoes: number;
}

export interface AvaliacaoRow {
  id: string;
  profissional_id: string;
  nota: number;
  comentario: string;
  data: Date;
  produtor_id: string;
  projeto_id: string;
  papel: string;
  genero: string;
  tipo_captacao: string;
}

export interface ParticipacaoRow {
  id?: number;
  profissional_id: string;
  projeto_id: string;
  titulo: string;
  papel: string;
  genero: string;
  tipo_captacao: string;
  ano: number;
}

export interface ProfissionalCompletoRow extends Omit<
  ProfissionalRow,
  'preco_minimo' | 'preco_maximo' | 'nota_media'
> {
  preco_minimo: Numerico;
  preco_maximo: Numerico;
  nota_media: Numerico;
  competencias: { nome: string; nivel: number }[];
  avaliacoes: (Omit<AvaliacaoRow, 'profissional_id' | 'data' | 'nota'> & {
    nota: Numerico;
    data: string;
  })[];
  historico: Omit<ParticipacaoRow, 'id' | 'profissional_id'>[];
  disponibilidades: { inicio: string; fim: string }[];
}

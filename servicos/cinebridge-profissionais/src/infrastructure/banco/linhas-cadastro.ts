export interface LinhaProfissional {
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

export interface LinhaCompetencia {
  profissional_id: string;
  nome: string;
  nivel: number;
}

export interface LinhaAvaliacao {
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

export interface LinhaParticipacao {
  profissional_id: string;
  projeto_id: string;
  titulo: string;
  papel: string;
  genero: string;
  tipo_captacao: string;
  ano: number;
}

export interface LinhaDisponibilidade {
  profissional_id: string;
  inicio: Date;
  fim: Date;
}

export interface LinhasCadastro {
  profissional: LinhaProfissional;
  competencias: LinhaCompetencia[];
  avaliacoes: LinhaAvaliacao[];
  historico: LinhaParticipacao[];
  disponibilidades: LinhaDisponibilidade[];
}

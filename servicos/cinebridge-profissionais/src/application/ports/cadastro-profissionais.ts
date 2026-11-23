import type { ProfissionalCompletoRow } from '../../contratos/consulta-profissionais.js';
import type { Papel } from '../../domain/catalogo.js';

export interface ResumoProfissional {
  readonly id: string;
  readonly nome: string;
  readonly especialidades: readonly string[];
  readonly preco_minimo: number | string;
  readonly preco_maximo: number | string;
  readonly cidade: string;
  readonly uf: string;
  readonly ativo: boolean;
  readonly nota_media: number | string;
  readonly total_avaliacoes: number;
}

export interface CadastroProfissionais {
  listarAtivos(): Promise<readonly ProfissionalCompletoRow[]>;
  obterPorIds(ids: readonly string[]): Promise<readonly ProfissionalCompletoRow[]>;
  obterPorId(id: string): Promise<ProfissionalCompletoRow | undefined>;
  listarResumo(papel: Papel | undefined, limite: number): Promise<readonly ResumoProfissional[]>;
}

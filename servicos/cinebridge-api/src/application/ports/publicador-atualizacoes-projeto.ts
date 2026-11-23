import type { AtualizacaoProjeto } from '../../contratos/atualizacoes-projetos.js';

export interface PublicadorAtualizacoesProjeto {
  publicar(atualizacao: AtualizacaoProjeto): Promise<void>;
}

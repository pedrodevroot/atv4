import type { PublicadorAtualizacoesProjeto } from '../../../application/ports/publicador-atualizacoes-projeto.js';
import type { AtualizacaoProjeto } from '../../../contratos/atualizacoes-projetos.js';
import { FILAS } from '../../../contratos/mensageria.js';
import type { PublicadorConfirmado } from './publicador-confirmado.js';

export class PublicadorAtualizacoesProjetoRabbitMQ implements PublicadorAtualizacoesProjeto {
  constructor(private readonly publicador: Pick<PublicadorConfirmado, 'publicar'>) {}

  publicar(atualizacao: AtualizacaoProjeto): Promise<void> {
    return this.publicador.publicar(FILAS.ATUALIZACOES_PROJETOS, atualizacao, {
      messageId: atualizacao.id,
      type: atualizacao.tipo,
      ...(atualizacao.correlacaoId === undefined
        ? {}
        : { correlationId: atualizacao.correlacaoId }),
    });
  }
}

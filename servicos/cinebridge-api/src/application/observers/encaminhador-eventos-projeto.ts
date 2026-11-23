import {
  ehAtualizacaoProjeto,
  type AtualizacaoProjeto,
  type SnapshotProjeto,
} from '../../contratos/atualizacoes-projetos.js';
import { criarEnvelope } from '../../contratos/mensageria.js';
import type { Projeto } from '../../domain/entidades/projeto.js';
import type { EventoRecomendacao } from '../../domain/eventos/evento-recomendacao.js';
import { naoEncontrado } from '../erros/erro-aplicacao.js';
import type { Logger } from '../ports/logger.js';
import { TODOS_OS_EVENTOS, type Observador } from '../ports/observador.js';
import type { PublicadorAtualizacoesProjeto } from '../ports/publicador-atualizacoes-projeto.js';
import type { RepositorioProjetos } from '../ports/repositorio-projetos.js';

export const ORIGEM_ENCAMINHADOR = 'encaminhador-eventos-projeto';
export const TAMANHO_MAXIMO_IDENTIFICADOR = 64;
export const TENTATIVAS_ENCAMINHAMENTO = 3;
export const ESPERA_ENCAMINHAMENTO_MS = 500;

export class AtualizacaoProjetoInvalida extends Error {
  constructor(eventoId: string) {
    super(`A atualização do evento ${eventoId} não respeita o contrato de atualizacoes-projetos.`);
    this.name = 'AtualizacaoProjetoInvalida';
  }
}

export interface OpcoesEncaminhador {
  readonly logger?: Logger;
  readonly tentativas?: number;
  readonly esperaMs?: number;
  readonly esperar?: (ms: number) => Promise<void>;
}

export function criarSnapshotProjeto(projeto: Projeto): SnapshotProjeto {
  const equipeFormada = projeto.equipeFormada;
  return {
    id: projeto.id,
    titulo: projeto.titulo,
    produtorId: projeto.produtorId,
    tipoCaptacao: projeto.tipoCaptacao,
    genero: projeto.genero,
    duracaoMinutos: projeto.duracaoMinutos,
    orcamento: projeto.orcamento,
    dataInicio: projeto.periodo.inicio.toISOString(),
    dataEntrega: projeto.periodo.fim.toISOString(),
    localizacao: { cidade: projeto.localizacao.cidade, uf: projeto.localizacao.uf },
    estrategia: projeto.estrategia,
    requisitos: projeto.requisitos.map((requisito) => ({
      papel: requisito.papel,
      peso: requisito.peso,
    })),
    ...(equipeFormada ? { equipeFormadaId: equipeFormada.id } : {}),
  };
}

function aguardar(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

export class EncaminhadorEventosProjeto implements Observador {
  readonly nome = ORIGEM_ENCAMINHADOR;
  readonly interesses = TODOS_OS_EVENTOS;
  private readonly logger: Logger | undefined;
  private readonly tentativas: number;
  private readonly esperaMs: number;
  private readonly esperar: (ms: number) => Promise<void>;

  constructor(
    private readonly projetos: RepositorioProjetos,
    private readonly publicador: PublicadorAtualizacoesProjeto,
    opcoes: OpcoesEncaminhador = {},
  ) {
    this.logger = opcoes.logger;
    this.tentativas = Math.max(1, opcoes.tentativas ?? TENTATIVAS_ENCAMINHAMENTO);
    this.esperaMs = opcoes.esperaMs ?? ESPERA_ENCAMINHAMENTO_MS;
    this.esperar = opcoes.esperar ?? aguardar;
  }

  async atualizar(evento: EventoRecomendacao): Promise<void> {
    const contexto = {
      eventoId: evento.id,
      tipo: evento.tipo,
      projetoId: evento.dados.projetoId,
      correlationId: evento.correlacaoId,
    };
    for (let tentativa = 1; ; tentativa += 1) {
      try {
        await this.encaminhar(evento);
        return;
      } catch (erro) {
        if (erro instanceof AtualizacaoProjetoInvalida || tentativa >= this.tentativas) {
          this.logger?.error(
            { ...contexto, tentativas: tentativa, err: erro },
            'Evento do projeto não foi encaminhado ao cinebridge-projetos',
          );
          throw erro;
        }
        this.logger?.warn(
          { ...contexto, tentativa, err: erro },
          'Falha ao encaminhar o evento do projeto; nova tentativa agendada',
        );
        await this.esperar(this.esperaMs * tentativa);
      }
    }
  }

  private async encaminhar(evento: EventoRecomendacao): Promise<void> {
    const projeto = await this.projetos.obter(evento.dados.projetoId);
    if (!projeto) {
      throw naoEncontrado('Projeto', evento.dados.projetoId);
    }
    const atualizacao = this.montarAtualizacao(evento, projeto);
    if (!ehAtualizacaoProjeto(atualizacao)) {
      throw new AtualizacaoProjetoInvalida(evento.id);
    }
    await this.publicador.publicar(atualizacao);
  }

  private montarAtualizacao(evento: EventoRecomendacao, projeto: Projeto): AtualizacaoProjeto {
    const correlacaoId = evento.correlacaoId;
    const correlacaoValida =
      correlacaoId !== undefined &&
      correlacaoId.length > 0 &&
      correlacaoId.length <= TAMANHO_MAXIMO_IDENTIFICADOR;
    return criarEnvelope(
      evento.tipo,
      { projeto: criarSnapshotProjeto(projeto), evento: { ...evento.dados } },
      'cinebridge-api',
      {
        id: evento.id,
        ocorridoEm: evento.ocorridoEm,
        ...(correlacaoValida ? { correlacaoId } : {}),
      },
    );
  }
}

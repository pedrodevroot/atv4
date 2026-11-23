import {
  TIPO_RESPOSTA_PROFISSIONAIS,
  ehConsultaProfissionais,
  type RespostaProfissionais,
  type ResultadoConsultaProfissionais,
} from '../contratos/consulta-profissionais.js';
import { criarEnvelope } from '../contratos/mensageria.js';
import type { CadastroProfissionais } from './ports/cadastro-profissionais.js';
import type { LoggerServico } from './ports/logger-servico.js';
import type { MensagemRecebida, ObservadorMensagem } from './ports/observador-mensagem.js';

export interface PublicadorRespostas {
  responder(
    replyTo: string,
    correlationId: string,
    corpo: object,
    propriedades?: { messageId?: string; type?: string },
  ): Promise<void>;
}

export const CODIGO_CONSULTA_INVALIDA = 'CONSULTA_INVALIDA';
export const CODIGO_FALHA_CONSULTA = 'FALHA_CONSULTA_CADASTRO';
export const MENSAGEM_CONSULTA_INVALIDA =
  'A consulta de profissionais não segue o contrato esperado';
export const MENSAGEM_FALHA_CONSULTA = 'Não foi possível consultar o cadastro de profissionais';

const TAMANHO_MAXIMO_ID = 64;

function identificadorValido(valor: string): boolean {
  return valor.length >= 1 && valor.length <= TAMANHO_MAXIMO_ID;
}

export class RespondedorConsultaProfissionais implements ObservadorMensagem<unknown> {
  readonly nome = 'RespondedorConsultaProfissionais';

  constructor(
    private readonly cadastro: CadastroProfissionais,
    private readonly publicador: PublicadorRespostas,
    private readonly logger: LoggerServico,
    private readonly relogio: () => number = () => performance.now(),
  ) {}

  async atualizar(mensagem: MensagemRecebida<unknown>): Promise<void> {
    const { replyTo, correlationId, messageId } = mensagem.propriedades;
    if (replyTo === undefined || correlationId === undefined || replyTo === '') {
      this.logger.warn(
        { fila: mensagem.fila, messageId, correlationId, replyTo },
        'Consulta de profissionais sem replyTo ou correlationId descartada',
      );
      return;
    }

    const inicio = this.relogio();
    const consulta = mensagem.conteudo;
    let operacao = 'desconhecida';
    let resultado: ResultadoConsultaProfissionais;

    if (ehConsultaProfissionais(consulta)) {
      operacao = consulta.dados.operacao;
      try {
        const profissionais =
          consulta.dados.operacao === 'listar-ativos'
            ? await this.cadastro.listarAtivos()
            : await this.cadastro.obterPorIds(consulta.dados.ids);
        resultado = { sucesso: true, profissionais };
      } catch (erro) {
        this.logger.error(
          { operacao, correlationId, replyTo, err: erro },
          'Falha ao consultar o cadastro de profissionais',
        );
        resultado = {
          sucesso: false,
          erro: { codigo: CODIGO_FALHA_CONSULTA, mensagem: MENSAGEM_FALHA_CONSULTA },
        };
      }
    } else {
      this.logger.warn(
        { fila: mensagem.fila, messageId, correlationId, replyTo },
        'Consulta de profissionais fora do contrato; respondendo com falha',
      );
      resultado = {
        sucesso: false,
        erro: { codigo: CODIGO_CONSULTA_INVALIDA, mensagem: MENSAGEM_CONSULTA_INVALIDA },
      };
    }

    const resposta = this.montarResposta(consulta, correlationId, resultado);
    await this.publicador.responder(replyTo, correlationId, resposta, {
      messageId: resposta.id,
      type: TIPO_RESPOSTA_PROFISSIONAIS,
    });

    this.logger.info(
      {
        operacao,
        correlationId,
        replyTo,
        sucesso: resultado.sucesso,
        quantidade: resultado.sucesso ? resultado.profissionais.length : 0,
        duracaoMs: Math.round(this.relogio() - inicio),
      },
      resultado.sucesso
        ? `Consulta de profissionais respondida (${operacao})`
        : `Consulta de profissionais respondida com falha (${operacao})`,
    );
  }

  private montarResposta(
    consulta: unknown,
    correlationId: string,
    resultado: ResultadoConsultaProfissionais,
  ): RespostaProfissionais {
    const correlacaoId = ehConsultaProfissionais(consulta)
      ? (consulta.correlacaoId ?? correlationId)
      : correlationId;
    return criarEnvelope(
      TIPO_RESPOSTA_PROFISSIONAIS,
      resultado,
      'cinebridge-profissionais',
      identificadorValido(correlacaoId) ? { correlacaoId } : {},
    );
  }
}

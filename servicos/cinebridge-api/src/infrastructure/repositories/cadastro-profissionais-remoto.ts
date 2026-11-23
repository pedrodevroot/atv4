import { ErroAplicacao } from '../../application/erros/erro-aplicacao.js';
import type { CadastroInterno } from '../../application/ports/adaptador-profissional.js';
import type { Profissional } from '../../domain/entidades/profissional.js';
import {
  TIPO_CONSULTA_PROFISSIONAIS,
  type ConsultaProfissionais,
  type OperacaoConsultaProfissionais,
  type ProfissionalCompletoRow,
  type RespostaProfissionais,
} from '../../contratos/consulta-profissionais.js';
import { criarEnvelope, type OpcoesEnvelope } from '../../contratos/mensageria.js';
import { paraProfissional } from '../database/mapeadores.js';

export interface SolicitanteConsultaProfissionais {
  solicitar(
    corpo: object,
    tipo: string,
    propriedades?: { readonly messageId?: string },
  ): Promise<RespostaProfissionais>;
}

export interface OpcoesCadastroRemoto {
  readonly gerarId?: () => string;
  readonly agora?: () => Date;
}

export const ORIGEM_CADASTRO_REMOTO = 'cinebridge-api';
export const CODIGO_CADASTRO_VAZIO = 'CADASTRO_VAZIO';
export const MENSAGEM_CADASTRO_VAZIO =
  'O cinebridge-profissionais respondeu sem profissionais ativos; o cadastro ainda pode estar sendo semeado';
export const MENSAGEM_CADASTRO_REMOTO =
  'O cadastro de profissionais é gerenciado pelo cinebridge-profissionais';

export class ErroCadastroRemoto extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'ErroCadastroRemoto';
  }
}

export class CadastroProfissionaisRemoto implements CadastroInterno {
  constructor(
    private readonly cliente: SolicitanteConsultaProfissionais,
    private readonly opcoes: OpcoesCadastroRemoto = {},
  ) {}

  async listarAtivos(): Promise<Profissional[]> {
    const perfis = await this.consultar({ operacao: 'listar-ativos' });
    if (perfis.length === 0) {
      throw new ErroCadastroRemoto(CODIGO_CADASTRO_VAZIO, MENSAGEM_CADASTRO_VAZIO);
    }
    return perfis.map(paraProfissional);
  }

  async obterPorIds(ids: readonly string[]): Promise<Map<string, Profissional>> {
    const unicos = [...new Set(ids)];
    if (unicos.length === 0) {
      return new Map();
    }
    const perfis = await this.consultar({ operacao: 'obter-por-ids', ids: unicos });
    return new Map(perfis.map((perfil) => [perfil.id, paraProfissional(perfil)]));
  }

  salvarTodos(): Promise<void> {
    return Promise.reject(new ErroAplicacao('OPERACAO_NAO_SUPORTADA', MENSAGEM_CADASTRO_REMOTO));
  }

  private async consultar(
    dados: OperacaoConsultaProfissionais,
  ): Promise<readonly ProfissionalCompletoRow[]> {
    const consulta: ConsultaProfissionais = criarEnvelope(
      TIPO_CONSULTA_PROFISSIONAIS,
      dados,
      ORIGEM_CADASTRO_REMOTO,
      this.opcoesEnvelope(),
    );
    const resposta = await this.cliente.solicitar(consulta, dados.operacao, {
      messageId: consulta.id,
    });
    const resultado = resposta.dados;
    if (!resultado.sucesso) {
      throw new ErroCadastroRemoto(
        resultado.erro.codigo,
        `O cinebridge-profissionais recusou a consulta ${dados.operacao} (${resultado.erro.codigo}): ${resultado.erro.mensagem}`,
      );
    }
    return resultado.profissionais;
  }

  private opcoesEnvelope(): OpcoesEnvelope {
    return {
      ...(this.opcoes.gerarId ? { id: this.opcoes.gerarId() } : {}),
      ...(this.opcoes.agora ? { ocorridoEm: this.opcoes.agora() } : {}),
    };
  }
}

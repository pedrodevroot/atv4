import type { TipoEventoApi } from '../contratos/atualizacoes-projetos.js';
import type {
  MetricasProjeto,
  StatusProjeto,
  TipoEventoProjeto,
} from '../contratos/eventos-projetos.js';

export type DadosEvento = Readonly<Record<string, unknown>>;

export interface Transicao {
  readonly status: StatusProjeto;
  readonly tipoEventoSaida: TipoEventoProjeto;
}

const TAMANHO_MAXIMO_IDENTIFICADOR = 64;

function contador(valor: unknown): number | undefined {
  return typeof valor === 'number' && Number.isInteger(valor) && valor >= 0 ? valor : undefined;
}

function numero(valor: unknown): number | undefined {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : undefined;
}

function texto(valor: unknown): string | undefined {
  return typeof valor === 'string' ? valor : undefined;
}

function identificador(valor: unknown): string | undefined {
  return typeof valor === 'string' &&
    valor.length > 0 &&
    valor.length <= TAMANHO_MAXIMO_IDENTIFICADOR
    ? valor
    : undefined;
}

function registro(valor: unknown): Readonly<Record<string, unknown>> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
    ? (valor as Readonly<Record<string, unknown>>)
    : {};
}

function somarDinheiro(atual: number, acrescimo: number): number {
  return Math.round((atual + acrescimo) * 100) / 100;
}

export function metricasIniciais(): MetricasProjeto {
  return {
    rodadas: 0,
    recomendacoesGeradas: 0,
    profissionaisRecomendados: 0,
    convites: { enviados: 0, aceitos: 0, recusados: 0, expirados: 0 },
    membrosRejeitados: 0,
    substituicoes: 0,
    substituicoesIndisponiveis: 0,
    reavaliacoes: 0,
    arquivos: 0,
    pagamentos: { efetuados: 0, cancelados: 0, valorTotal: 0 },
  };
}

function lerEquipeFormada(valor: unknown): MetricasProjeto['equipeFormada'] {
  const dados = registro(valor);
  const equipeId = identificador(dados.equipeId);
  if (equipeId === undefined) {
    return undefined;
  }
  const membros = Array.isArray(dados.membros)
    ? dados.membros.flatMap((item: unknown) => {
        const membro = registro(item);
        const papel = texto(membro.papel);
        const profissionalId = identificador(membro.profissionalId);
        return papel === undefined || profissionalId === undefined
          ? []
          : [{ papel, profissionalId, custo: numero(membro.custo) ?? 0 }];
      })
    : [];
  const custoTotal =
    numero(dados.custoTotal) ??
    membros.reduce((soma, membro) => somarDinheiro(soma, membro.custo), 0);
  return { equipeId, custoTotal, membros };
}

export function normalizarMetricas(valor: unknown): MetricasProjeto {
  const bruto = registro(valor);
  const inicial = metricasIniciais();
  const convites = registro(bruto.convites);
  const pagamentos = registro(bruto.pagamentos);
  const ultimaEstrategia = texto(bruto.ultimaEstrategia);
  const equipeFormada = lerEquipeFormada(bruto.equipeFormada);
  return {
    rodadas: contador(bruto.rodadas) ?? inicial.rodadas,
    ...(ultimaEstrategia === undefined ? {} : { ultimaEstrategia }),
    recomendacoesGeradas: contador(bruto.recomendacoesGeradas) ?? inicial.recomendacoesGeradas,
    profissionaisRecomendados:
      contador(bruto.profissionaisRecomendados) ?? inicial.profissionaisRecomendados,
    convites: {
      enviados: contador(convites.enviados) ?? 0,
      aceitos: contador(convites.aceitos) ?? 0,
      recusados: contador(convites.recusados) ?? 0,
      expirados: contador(convites.expirados) ?? 0,
    },
    membrosRejeitados: contador(bruto.membrosRejeitados) ?? 0,
    substituicoes: contador(bruto.substituicoes) ?? 0,
    substituicoesIndisponiveis: contador(bruto.substituicoesIndisponiveis) ?? 0,
    reavaliacoes: contador(bruto.reavaliacoes) ?? 0,
    arquivos: contador(bruto.arquivos) ?? 0,
    pagamentos: {
      efetuados: contador(pagamentos.efetuados) ?? 0,
      cancelados: contador(pagamentos.cancelados) ?? 0,
      valorTotal: numero(pagamentos.valorTotal) ?? 0,
    },
    ...(equipeFormada === undefined ? {} : { equipeFormada }),
  };
}

function aplicarRecomendacao(metricas: MetricasProjeto, dados: DadosEvento): MetricasProjeto {
  const rodada = contador(dados.rodada) ?? metricas.rodadas + 1;
  const base: MetricasProjeto = {
    ...metricas,
    rodadas: Math.max(metricas.rodadas, rodada),
    recomendacoesGeradas: metricas.recomendacoesGeradas + 1,
  };
  if (rodada < metricas.rodadas) {
    return base;
  }
  const estrategia = texto(dados.estrategia);
  return {
    ...base,
    ...(estrategia === undefined ? {} : { ultimaEstrategia: estrategia }),
    profissionaisRecomendados: Array.isArray(dados.profissionais)
      ? dados.profissionais.length
      : metricas.profissionaisRecomendados,
  };
}

export function aplicarEvento(
  metricas: MetricasProjeto,
  motivo: TipoEventoApi,
  dados: DadosEvento,
): MetricasProjeto {
  const { convites, pagamentos } = metricas;
  switch (motivo) {
    case 'RECOMENDACAO_GERADA':
      return aplicarRecomendacao(metricas, dados);
    case 'CONVITE_ENVIADO':
      return { ...metricas, convites: { ...convites, enviados: convites.enviados + 1 } };
    case 'CONVITE_ACEITO':
      return { ...metricas, convites: { ...convites, aceitos: convites.aceitos + 1 } };
    case 'CONVITE_RECUSADO':
      return { ...metricas, convites: { ...convites, recusados: convites.recusados + 1 } };
    case 'CONVITE_EXPIRADO':
      return { ...metricas, convites: { ...convites, expirados: convites.expirados + 1 } };
    case 'MEMBRO_REJEITADO':
      return { ...metricas, membrosRejeitados: metricas.membrosRejeitados + 1 };
    case 'SUBSTITUICAO_SOLICITADA':
      return { ...metricas, substituicoes: metricas.substituicoes + 1 };
    case 'SUBSTITUICAO_INDISPONIVEL':
      return { ...metricas, substituicoesIndisponiveis: metricas.substituicoesIndisponiveis + 1 };
    case 'REAVALIACAO_SOLICITADA':
      return { ...metricas, reavaliacoes: metricas.reavaliacoes + 1 };
    case 'DETALHES_ATUALIZADOS':
      return metricas;
    case 'EQUIPE_FORMADA': {
      const equipeFormada = lerEquipeFormada(dados);
      return equipeFormada === undefined ? metricas : { ...metricas, equipeFormada };
    }
    case 'ARQUIVO_ANEXADO':
      return { ...metricas, arquivos: metricas.arquivos + 1 };
    case 'PAGAMENTO_EFETUADO':
      return {
        ...metricas,
        pagamentos: {
          ...pagamentos,
          efetuados: pagamentos.efetuados + 1,
          valorTotal: somarDinheiro(pagamentos.valorTotal, numero(dados.valor) ?? 0),
        },
      };
    case 'PAGAMENTO_CANCELADO':
      return { ...metricas, pagamentos: { ...pagamentos, cancelados: pagamentos.cancelados + 1 } };
  }
}

export function decidirTransicao(
  statusAtual: StatusProjeto | undefined,
  motivo: TipoEventoApi,
): Transicao {
  if (statusAtual === undefined) {
    return {
      status: motivo === 'EQUIPE_FORMADA' ? 'FINALIZADO' : 'CRIADO',
      tipoEventoSaida: 'PROJETO_CRIADO',
    };
  }
  if (motivo === 'EQUIPE_FORMADA') {
    return { status: 'FINALIZADO', tipoEventoSaida: 'PROJETO_FINALIZADO' };
  }
  return {
    status: statusAtual === 'FINALIZADO' ? 'FINALIZADO' : 'EM_ANDAMENTO',
    tipoEventoSaida: 'PROJETO_ATUALIZADO',
  };
}

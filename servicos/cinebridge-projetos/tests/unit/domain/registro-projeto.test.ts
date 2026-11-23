import { describe, expect, it } from 'vitest';
import { ehEventoProjeto } from '../../../src/contratos/eventos-projetos.js';
import { metricasIniciais } from '../../../src/domain/ciclo-vida.js';
import {
  normalizarSnapshot,
  registrarAtualizacao,
  snapshotEhMaisRecente,
  type RegistroProjeto,
} from '../../../src/domain/registro-projeto.js';
import {
  DADOS_EQUIPE_FORMADA,
  DADOS_RECOMENDACAO,
  SNAPSHOT,
  criarAtualizacao,
} from '../fixtures.js';

const AGORA = new Date('2026-11-22T12:00:05.000Z');
const OPCOES = { idEventoSaida: 'saida-1', agora: AGORA };

function registrado(sobrescrever: Partial<RegistroProjeto> = {}): RegistroProjeto {
  return {
    snapshot: SNAPSHOT,
    status: 'CRIADO',
    metricas: { ...metricasIniciais(), rodadas: 1, recomendacoesGeradas: 1 },
    criadoEm: '2026-11-22T12:00:00.000Z',
    atualizadoEm: '2026-11-22T12:00:00.000Z',
    ...sobrescrever,
  };
}

describe('registrarAtualizacao', () => {
  it('registra o projeto novo e monta um PROJETO_CRIADO válido pelo contrato', () => {
    const atualizacao = criarAtualizacao('RECOMENDACAO_GERADA', DADOS_RECOMENDACAO);

    const { registro, transicao, eventoSaida } = registrarAtualizacao(
      undefined,
      atualizacao,
      OPCOES,
    );

    expect(transicao).toEqual({ status: 'CRIADO', tipoEventoSaida: 'PROJETO_CRIADO' });
    expect(registro).toMatchObject({
      snapshot: SNAPSHOT,
      status: 'CRIADO',
      criadoEm: atualizacao.ocorridoEm,
      atualizadoEm: atualizacao.ocorridoEm,
    });
    expect(registro.finalizadoEm).toBeUndefined();
    expect(registro.metricas.rodadas).toBe(1);
    expect(ehEventoProjeto(eventoSaida)).toBe(true);
    expect(eventoSaida).toEqual({
      id: 'saida-1',
      tipo: 'PROJETO_CRIADO',
      versao: 1,
      ocorridoEm: AGORA.toISOString(),
      origem: 'cinebridge-projetos',
      correlacaoId: 'req-1',
      dados: {
        projeto: { ...SNAPSHOT, status: 'CRIADO', metricas: registro.metricas },
        motivo: 'RECOMENDACAO_GERADA',
        eventoOrigemId: atualizacao.id,
        detalhe: DADOS_RECOMENDACAO,
      },
    });
  });

  it('omite a correlação quando a atualização não tem uma', () => {
    const atualizacao = criarAtualizacao('CONVITE_ENVIADO', {}, { correlacaoId: null });

    const { eventoSaida } = registrarAtualizacao(registrado(), atualizacao, OPCOES);

    expect(eventoSaida).not.toHaveProperty('correlacaoId');
    expect(ehEventoProjeto(eventoSaida)).toBe(true);
  });

  it('aplica o snapshot mais novo, passa a EM_ANDAMENTO e soma as métricas', () => {
    const atualizacao = criarAtualizacao(
      'DETALHES_ATUALIZADOS',
      {},
      {
        ocorridoEm: '2026-11-22T13:00:00.000Z',
        projeto: { titulo: 'Curta na Serra (corte final)' },
      },
    );

    const { registro, eventoSaida } = registrarAtualizacao(registrado(), atualizacao, OPCOES);

    expect(registro.snapshot.titulo).toBe('Curta na Serra (corte final)');
    expect(registro.status).toBe('EM_ANDAMENTO');
    expect(registro.atualizadoEm).toBe('2026-11-22T13:00:00.000Z');
    expect(eventoSaida.tipo).toBe('PROJETO_ATUALIZADO');
    expect(eventoSaida.dados.projeto.titulo).toBe('Curta na Serra (corte final)');
  });

  it('não deixa um snapshot mais antigo sobrescrever campos mais novos, mas conta o evento', () => {
    const atual = registrado({
      snapshot: { ...SNAPSHOT, titulo: 'Título novo', orcamento: 95_000 },
      atualizadoEm: '2026-11-22T15:00:00.000Z',
    });
    const atrasada = criarAtualizacao(
      'CONVITE_ACEITO',
      {},
      { ocorridoEm: '2026-11-22T14:00:00.000Z', projeto: { titulo: 'Título velho' } },
    );

    const { registro, eventoSaida } = registrarAtualizacao(atual, atrasada, OPCOES);

    expect(registro.snapshot).toMatchObject({ titulo: 'Título novo', orcamento: 95_000 });
    expect(registro.atualizadoEm).toBe('2026-11-22T15:00:00.000Z');
    expect(registro.metricas.convites.aceitos).toBe(1);
    expect(registro.criadoEm).toBe('2026-11-22T12:00:00.000Z');
    expect(eventoSaida.dados.projeto.titulo).toBe('Título novo');
  });

  it('recua a data de criação quando chega um evento anterior ao primeiro registrado', () => {
    const atual = registrado({
      criadoEm: '2026-11-22T12:00:00.000Z',
      atualizadoEm: '2026-11-22T12:00:00.000Z',
    });
    const anterior = criarAtualizacao('RECOMENDACAO_GERADA', DADOS_RECOMENDACAO, {
      ocorridoEm: '2026-11-22T11:00:00.000Z',
    });

    const { registro } = registrarAtualizacao(atual, anterior, OPCOES);

    expect(registro.criadoEm).toBe('2026-11-22T11:00:00.000Z');
    expect(registro.atualizadoEm).toBe('2026-11-22T12:00:00.000Z');
  });

  it('finaliza com EQUIPE_FORMADA, grava finalizadoEm e não o troca depois', () => {
    const formada = criarAtualizacao('EQUIPE_FORMADA', DADOS_EQUIPE_FORMADA, {
      ocorridoEm: '2026-11-23T10:00:00.000Z',
      projeto: { equipeFormadaId: 'equipe-1' },
    });

    const finalizado = registrarAtualizacao(registrado(), formada, OPCOES);

    expect(finalizado.transicao.tipoEventoSaida).toBe('PROJETO_FINALIZADO');
    expect(finalizado.registro).toMatchObject({
      status: 'FINALIZADO',
      finalizadoEm: '2026-11-23T10:00:00.000Z',
    });
    expect(finalizado.eventoSaida.dados.projeto.equipeFormadaId).toBe('equipe-1');
    expect(ehEventoProjeto(finalizado.eventoSaida)).toBe(true);

    const pagamento = criarAtualizacao(
      'PAGAMENTO_EFETUADO',
      { valor: 100 },
      { ocorridoEm: '2026-11-24T10:00:00.000Z' },
    );
    const depois = registrarAtualizacao(finalizado.registro, pagamento, OPCOES);

    expect(depois.transicao).toEqual({
      status: 'FINALIZADO',
      tipoEventoSaida: 'PROJETO_ATUALIZADO',
    });
    expect(depois.registro.finalizadoEm).toBe('2026-11-23T10:00:00.000Z');
  });

  it('registra como FINALIZADO e com finalizadoEm o projeto que chega já com equipe', () => {
    const formada = criarAtualizacao('EQUIPE_FORMADA', DADOS_EQUIPE_FORMADA);

    const { registro, eventoSaida } = registrarAtualizacao(undefined, formada, OPCOES);

    expect(registro.status).toBe('FINALIZADO');
    expect(registro.finalizadoEm).toBe(formada.ocorridoEm);
    expect(eventoSaida.tipo).toBe('PROJETO_CRIADO');
  });
});

describe('normalizarSnapshot', () => {
  it('guarda só os campos do contrato', () => {
    const comExtra = { ...SNAPSHOT, segredo: 'não vai adiante' } as typeof SNAPSHOT;

    expect(normalizarSnapshot(comExtra)).toEqual(SNAPSHOT);
  });
});

describe('snapshotEhMaisRecente', () => {
  it('compara instantes, inclusive com fuso diferente', () => {
    expect(snapshotEhMaisRecente('2026-11-22T09:00:00-03:00', '2026-11-22T12:00:00.000Z')).toBe(
      true,
    );
    expect(snapshotEhMaisRecente('2026-11-22T08:59:59-03:00', '2026-11-22T12:00:00.000Z')).toBe(
      false,
    );
  });
});

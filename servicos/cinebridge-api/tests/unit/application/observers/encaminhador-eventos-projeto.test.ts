import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AtualizacaoProjetoInvalida,
  EncaminhadorEventosProjeto,
  criarSnapshotProjeto,
} from '../../../../src/application/observers/encaminhador-eventos-projeto.js';
import { TODOS_OS_EVENTOS, type Observador } from '../../../../src/application/ports/observador.js';
import type { PublicadorAtualizacoesProjeto } from '../../../../src/application/ports/publicador-atualizacoes-projeto.js';
import {
  TIPOS_EVENTO_API,
  ehAtualizacaoProjeto,
  type AtualizacaoProjeto,
} from '../../../../src/contratos/atualizacoes-projetos.js';
import type { Projeto } from '../../../../src/domain/entidades/projeto.js';
import { Papel } from '../../../../src/domain/enums/papel.js';
import {
  TIPOS_EVENTO,
  criarEvento,
  type DadosPorTipoEvento,
  type EventoRecomendacao,
} from '../../../../src/domain/eventos/evento-recomendacao.js';
import { BarramentoEventosEmMemoria } from '../../../../src/infrastructure/messaging/barramento-eventos-memoria.js';
import { RepositorioProjetosMemoria } from '../../../../src/infrastructure/repositories/repositorio-projetos-memoria.js';
import { criarProjetoDemonstracao } from '../../../fixtures/cadastro-demonstracao.js';
import { criarAmbienteOrquestracao } from '../../../fixtures/orquestracao.js';

const OCORRIDO_EM = new Date('2026-11-22T15:30:00.000Z');

function criarLoggerFalso() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function eventoDoProjeto(
  projeto: Projeto,
  correlacaoId: string | null = 'req-123',
): EventoRecomendacao {
  return criarEvento(
    'CONVITE_ENVIADO',
    {
      conviteId: 'convite-1',
      projetoId: projeto.id,
      produtorId: projeto.produtorId,
      equipeId: 'equipe-1',
      papel: Papel.EDITOR,
      profissionalId: 'editora',
      expiraEm: '2026-11-29T15:30:00.000Z',
    },
    { origem: 'teste', ocorridoEm: OCORRIDO_EM, ...(correlacaoId ? { correlacaoId } : {}) },
  );
}

describe('EncaminhadorEventosProjeto', () => {
  const ambiente = criarAmbienteOrquestracao();
  let projetos: RepositorioProjetosMemoria;
  let projeto: Projeto;
  let publicadas: AtualizacaoProjeto[];
  let publicador: PublicadorAtualizacoesProjeto;
  let esperas: number[];
  let logger: ReturnType<typeof criarLoggerFalso>;

  const criarEncaminhador = (opcoes: { tentativas?: number } = {}) =>
    new EncaminhadorEventosProjeto(projetos, publicador, {
      logger,
      esperaMs: 100,
      esperar: (ms) => {
        esperas.push(ms);
        return Promise.resolve();
      },
      ...opcoes,
    });

  beforeEach(async () => {
    projetos = new RepositorioProjetosMemoria(ambiente.fabricas);
    projeto = criarProjetoDemonstracao();
    await projetos.salvar(projeto);
    publicadas = [];
    esperas = [];
    logger = criarLoggerFalso();
    publicador = {
      publicar: (atualizacao) => {
        publicadas.push(atualizacao);
        return Promise.resolve();
      },
    };
  });

  it('observa todos os eventos do barramento', () => {
    expect(criarEncaminhador().interesses).toBe(TODOS_OS_EVENTOS);
    expect(criarEncaminhador().nome).toBe('encaminhador-eventos-projeto');
  });

  it('publica um envelope com id, tipo, instante e correlação do evento de domínio', async () => {
    const evento = eventoDoProjeto(projeto);

    await criarEncaminhador().atualizar(evento);

    expect(publicadas).toHaveLength(1);
    expect(publicadas[0]).toMatchObject({
      id: evento.id,
      tipo: 'CONVITE_ENVIADO',
      versao: 1,
      ocorridoEm: OCORRIDO_EM.toISOString(),
      origem: 'cinebridge-api',
      correlacaoId: 'req-123',
      dados: { evento: evento.dados },
    });
    expect(ehAtualizacaoProjeto(publicadas[0])).toBe(true);
  });

  it('monta o snapshot do projeto relido do repositório', async () => {
    await criarEncaminhador().atualizar(eventoDoProjeto(projeto));

    const snapshot = publicadas[0]?.dados.projeto;
    expect(snapshot).toEqual({
      id: projeto.id,
      titulo: projeto.titulo,
      produtorId: projeto.produtorId,
      tipoCaptacao: 'FICCAO',
      genero: 'Drama',
      duracaoMinutos: projeto.duracaoMinutos,
      orcamento: projeto.orcamento,
      dataInicio: projeto.periodo.inicio.toISOString(),
      dataEntrega: projeto.periodo.fim.toISOString(),
      localizacao: { cidade: projeto.localizacao.cidade, uf: projeto.localizacao.uf },
      estrategia: 'similaridade-cosseno',
      requisitos: projeto.requisitos.map(({ papel, peso }) => ({ papel, peso })),
    });
  });

  it('inclui a equipe formada no snapshot quando ela existe', () => {
    const comEquipe = Object.create(projeto, {
      equipeFormada: { value: { id: 'equipe-formada' } },
    }) as Projeto;

    expect(criarSnapshotProjeto(comEquipe).equipeFormadaId).toBe('equipe-formada');
    expect(criarSnapshotProjeto(projeto)).not.toHaveProperty('equipeFormadaId');
  });

  it('omite a correlação ausente ou maior que 64 caracteres', async () => {
    const encaminhador = criarEncaminhador();

    await encaminhador.atualizar(eventoDoProjeto(projeto, null));
    await encaminhador.atualizar(eventoDoProjeto(projeto, 'r'.repeat(65)));
    await encaminhador.atualizar(eventoDoProjeto(projeto, 'r'.repeat(64)));

    expect(publicadas[0]).not.toHaveProperty('correlacaoId');
    expect(publicadas[1]).not.toHaveProperty('correlacaoId');
    expect(publicadas[2]?.correlacaoId).toBe('r'.repeat(64));
  });

  it('cobre os 14 tipos de evento do domínio com envelopes válidos', async () => {
    expect([...TIPOS_EVENTO]).toEqual([...TIPOS_EVENTO_API]);
    const encaminhador = criarEncaminhador();

    for (const tipo of TIPOS_EVENTO) {
      const evento = criarEvento(
        tipo,
        {
          projetoId: projeto.id,
          produtorId: projeto.produtorId,
        } as DadosPorTipoEvento[typeof tipo],
        { origem: 'teste' },
      );
      await encaminhador.atualizar(evento as EventoRecomendacao);
    }

    expect(publicadas.map((atualizacao) => atualizacao.tipo)).toEqual([...TIPOS_EVENTO]);
    expect(publicadas.every((atualizacao) => ehAtualizacaoProjeto(atualizacao))).toBe(true);
  });

  it('tenta de novo quando a publicação falha e entrega o mesmo envelope', async () => {
    const falhas = [new Error('rabbit fora'), new Error('rabbit fora')];
    publicador = {
      publicar: (atualizacao) => {
        const falha = falhas.shift();
        if (falha) {
          return Promise.reject(falha);
        }
        publicadas.push(atualizacao);
        return Promise.resolve();
      },
    };
    const evento = eventoDoProjeto(projeto);

    await criarEncaminhador().atualizar(evento);

    expect(publicadas).toHaveLength(1);
    expect(publicadas[0]?.id).toBe(evento.id);
    expect(esperas).toEqual([100, 200]);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('desiste depois das tentativas, registra o erro e relança para o barramento', async () => {
    const erro = new Error('rabbit fora');
    const publicar = vi.fn(() => Promise.reject(erro));
    publicador = { publicar };
    const evento = eventoDoProjeto(projeto);

    await expect(criarEncaminhador().atualizar(evento)).rejects.toBe(erro);

    expect(publicar).toHaveBeenCalledTimes(3);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        eventoId: evento.id,
        tipo: 'CONVITE_ENVIADO',
        projetoId: projeto.id,
        tentativas: 3,
      }),
      'Evento do projeto não foi encaminhado ao cinebridge-projetos',
    );
  });

  it('respeita o número de tentativas configurado', async () => {
    const publicar = vi.fn(() => Promise.reject(new Error('fora')));
    publicador = { publicar };

    await expect(
      criarEncaminhador({ tentativas: 1 }).atualizar(eventoDoProjeto(projeto)),
    ).rejects.toThrow('fora');

    expect(publicar).toHaveBeenCalledTimes(1);
    expect(esperas).toEqual([]);
  });

  it('falha quando o projeto não existe mais, sem publicar nada', async () => {
    const evento = criarEvento(
      'ARQUIVO_ANEXADO',
      {
        projetoId: 'inexistente',
        produtorId: 'produtor-1',
        arquivoId: 'a',
        nome: 'n',
        provedor: 'p',
        tamanhoBytes: 1,
      },
      { origem: 'teste' },
    );

    await expect(criarEncaminhador({ tentativas: 2 }).atualizar(evento)).rejects.toThrow(
      'Projeto inexistente não encontrado.',
    );

    expect(publicadas).toEqual([]);
  });

  it('não tenta de novo uma atualização que viola o contrato', async () => {
    const evento = { ...eventoDoProjeto(projeto), id: 'x'.repeat(65) } as EventoRecomendacao;

    await expect(criarEncaminhador().atualizar(evento)).rejects.toBeInstanceOf(
      AtualizacaoProjetoInvalida,
    );

    expect(publicadas).toEqual([]);
    expect(esperas).toEqual([]);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('funciona sem logger', async () => {
    const encaminhador = new EncaminhadorEventosProjeto(projetos, publicador);

    await encaminhador.atualizar(eventoDoProjeto(projeto));

    expect(publicadas).toHaveLength(1);
  });

  it('erro de publicação não derruba os outros observadores do barramento', async () => {
    publicador = { publicar: () => Promise.reject(new Error('rabbit fora')) };
    const falhas: string[] = [];
    const barramento = new BarramentoEventosEmMemoria((falha) => falhas.push(falha.observador));
    const recebidos: string[] = [];
    const outro: Observador = {
      nome: 'outro',
      interesses: TODOS_OS_EVENTOS,
      atualizar: (evento) => {
        recebidos.push(evento.id);
        return Promise.resolve();
      },
    };
    const evento = eventoDoProjeto(projeto);
    barramento.adicionarObservador(criarEncaminhador({ tentativas: 1 }));
    barramento.adicionarObservador(outro);

    barramento.notificarObservadores(evento);
    await barramento.aguardarEntregas();

    expect(recebidos).toEqual([evento.id]);
    expect(falhas).toEqual(['encaminhador-eventos-projeto']);
  });
});

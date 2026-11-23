import { describe, expect, it, vi } from 'vitest';
import type { MensagemRecebida } from '../../../src/application/ports/observador-mensagem.js';
import {
  ErroAtualizacaoRecusada,
  type ResultadoProcessamento,
  type SituacaoAtualizacao,
} from '../../../src/application/ports/repositorio-projetos.js';
import { RegistradorCicloVida } from '../../../src/application/registrador-ciclo-vida.js';
import type { AtualizacaoProjeto } from '../../../src/contratos/atualizacoes-projetos.js';
import type { EventoProjeto } from '../../../src/contratos/eventos-projetos.js';
import { registrarAtualizacao } from '../../../src/domain/registro-projeto.js';
import { DADOS_RECOMENDACAO, criarAtualizacao } from '../fixtures.js';

const ATUALIZACAO = criarAtualizacao('RECOMENDACAO_GERADA', DADOS_RECOMENDACAO);
const { eventoSaida: EVENTO_SAIDA } = registrarAtualizacao(undefined, ATUALIZACAO, {
  idEventoSaida: 'saida-1',
  agora: new Date('2026-11-22T12:00:05.000Z'),
});

function mensagem(
  conteudo: AtualizacaoProjeto = ATUALIZACAO,
): MensagemRecebida<AtualizacaoProjeto> {
  return {
    fila: 'atualizacoes-projetos',
    conteudo,
    propriedades: { messageId: conteudo.id, headers: {} },
    reentregue: false,
  };
}

function montar(processar: () => Promise<ResultadoProcessamento>) {
  const repositorio = {
    processarAtualizacao: vi.fn(processar),
    marcarPublicado: vi.fn(async () => undefined),
  };
  const publicador = { publicar: vi.fn(async () => undefined) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const registrador = new RegistradorCicloVida(repositorio, publicador, logger);
  return { registrador, repositorio, publicador, logger };
}

function com(situacao: SituacaoAtualizacao) {
  return async (): Promise<ResultadoProcessamento> => ({ situacao, eventoSaida: EVENTO_SAIDA });
}

describe('RegistradorCicloVida', () => {
  it('é um observador nomeado', () => {
    expect(montar(com('registrada')).registrador.nome).toBe('RegistradorCicloVida');
  });

  it('registra, publica o evento de saída em eventos-projetos e só então marca publicado', async () => {
    const { registrador, repositorio, publicador, logger } = montar(com('registrada'));
    const ordem: string[] = [];
    publicador.publicar.mockImplementation(async () => {
      ordem.push('publicar');
    });
    repositorio.marcarPublicado.mockImplementation(async () => {
      ordem.push('marcar');
    });

    await registrador.atualizar(mensagem());

    expect(repositorio.processarAtualizacao).toHaveBeenCalledWith(ATUALIZACAO);
    expect(publicador.publicar).toHaveBeenCalledWith('eventos-projetos', EVENTO_SAIDA, {
      messageId: 'saida-1',
      type: 'PROJETO_CRIADO',
      correlationId: 'req-1',
    });
    expect(repositorio.marcarPublicado).toHaveBeenCalledWith(ATUALIZACAO.id);
    expect(ordem).toEqual(['publicar', 'marcar']);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        projetoId: 'projeto-1',
        motivo: 'RECOMENDACAO_GERADA',
        status: 'CRIADO',
        eventoSaida: 'PROJETO_CRIADO',
        eventoSaidaId: 'saida-1',
      }),
      'Ciclo de vida do projeto registrado',
    );
  });

  it('não publica de novo uma atualização repetida cujo evento já saiu', async () => {
    const { registrador, repositorio, publicador, logger } = montar(com('repetida'));

    await registrador.atualizar(mensagem());

    expect(publicador.publicar).not.toHaveBeenCalled();
    expect(repositorio.marcarPublicado).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ eventoSaidaId: 'saida-1' }),
      'Atualização repetida; o evento de saída já foi publicado',
    );
  });

  it('republica o mesmo evento de saída (mesmo id) quando a repetição estava pendente', async () => {
    const { registrador, repositorio, publicador, logger } = montar(com('pendente'));

    await registrador.atualizar(mensagem());

    expect(publicador.publicar).toHaveBeenCalledWith(
      'eventos-projetos',
      EVENTO_SAIDA,
      expect.objectContaining({ messageId: 'saida-1' }),
    );
    expect(repositorio.marcarPublicado).toHaveBeenCalledWith(ATUALIZACAO.id);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.anything(),
      'Atualização repetida; republicando o evento pendente',
    );
  });

  it('publica sem correlationId quando o evento de saída não tem correlação', async () => {
    const semCorrelacao = Object.fromEntries(
      Object.entries(EVENTO_SAIDA).filter(([chave]) => chave !== 'correlacaoId'),
    ) as unknown as EventoProjeto;
    const { registrador, publicador } = montar(async () => ({
      situacao: 'registrada',
      eventoSaida: semCorrelacao,
    }));

    await registrador.atualizar(mensagem());

    expect(publicador.publicar).toHaveBeenCalledWith('eventos-projetos', semCorrelacao, {
      messageId: 'saida-1',
      type: 'PROJETO_CRIADO',
    });
  });

  it('propaga a falha de publicação sem marcar publicado, para a mensagem voltar à fila', async () => {
    const { registrador, repositorio, publicador } = montar(com('registrada'));
    publicador.publicar.mockRejectedValue(new Error('RabbitMQ indisponível'));

    await expect(registrador.atualizar(mensagem())).rejects.toThrow('RabbitMQ indisponível');

    expect(repositorio.marcarPublicado).not.toHaveBeenCalled();
  });

  it('propaga a falha ao marcar publicado, para a reentrega republicar o mesmo evento', async () => {
    const { registrador, repositorio } = montar(com('registrada'));
    repositorio.marcarPublicado.mockRejectedValue(new Error('PostgreSQL caiu'));

    await expect(registrador.atualizar(mensagem())).rejects.toThrow('PostgreSQL caiu');
  });

  it('propaga falhas do banco (indisponível) para nova tentativa', async () => {
    const { registrador, publicador } = montar(async () => {
      throw new Error('connect ECONNREFUSED');
    });

    await expect(registrador.atualizar(mensagem())).rejects.toThrow('ECONNREFUSED');
    expect(publicador.publicar).not.toHaveBeenCalled();
  });

  it('descarta com log de erro a atualização que o banco recusa por dado inválido', async () => {
    const { registrador, publicador, logger } = montar(async () => {
      throw new ErroAtualizacaoRecusada('value too long');
    });

    await expect(registrador.atualizar(mensagem())).resolves.toBeUndefined();

    expect(publicador.publicar).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ eventoOrigemId: ATUALIZACAO.id }),
      'Atualização recusada pelo banco; mensagem descartada para não travar a fila',
    );
  });
});

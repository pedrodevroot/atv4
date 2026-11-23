import { describe, expect, it } from 'vitest';
import type { AtualizacaoProjeto } from '../../../../../src/contratos/atualizacoes-projetos.js';
import { criarEnvelope } from '../../../../../src/contratos/mensageria.js';
import { ConexaoRabbitMQ } from '../../../../../src/infrastructure/mensageria/rabbitmq/conexao-rabbitmq.js';
import { PublicadorAtualizacoesProjetoRabbitMQ } from '../../../../../src/infrastructure/mensageria/rabbitmq/publicador-atualizacoes-projeto.js';
import { PublicadorConfirmado } from '../../../../../src/infrastructure/mensageria/rabbitmq/publicador-confirmado.js';
import { CONFIG_RABBITMQ, criarConectorFalso, criarLoggerFalso } from './dubles-rabbitmq.js';

function atualizacao(correlacaoId?: string): AtualizacaoProjeto {
  return criarEnvelope(
    'CONVITE_ACEITO',
    {
      projeto: {
        id: 'projeto-1',
        titulo: 'Documentário',
        produtorId: 'produtor-1',
        tipoCaptacao: 'DOCUMENTARIO',
        genero: 'Drama',
        duracaoMinutos: 90,
        orcamento: 100_000,
        dataInicio: '2027-01-10T00:00:00.000Z',
        dataEntrega: '2027-03-10T00:00:00.000Z',
        localizacao: { cidade: 'Belo Horizonte', uf: 'MG' },
        estrategia: 'similaridade-cosseno',
        requisitos: [{ papel: 'DIRETOR', peso: 5 }],
      },
      evento: { projetoId: 'projeto-1', papel: 'DIRETOR' },
    },
    'cinebridge-api',
    {
      id: 'evento-1',
      ocorridoEm: '2026-11-22T15:30:00.000Z',
      ...(correlacaoId ? { correlacaoId } : {}),
    },
  );
}

function montar() {
  const conector = criarConectorFalso();
  const { logger } = criarLoggerFalso();
  const conexao = new ConexaoRabbitMQ(CONFIG_RABBITMQ, logger, {
    intervaloReconexaoMs: 1_000,
    conectar: conector.conectar,
  });
  const confirmado = new PublicadorConfirmado(conexao, logger, { limiteConexaoMs: 0 });
  return {
    conector,
    conexao,
    publicador: new PublicadorAtualizacoesProjetoRabbitMQ(confirmado),
  };
}

describe('PublicadorAtualizacoesProjetoRabbitMQ', () => {
  it('publica na fila durável atualizacoes-projetos com o id do evento como messageId', async () => {
    const { conector, conexao, publicador } = montar();
    await conexao.iniciar();
    const envelope = atualizacao('req-9');

    await publicador.publicar(envelope);

    const canal = conector.ultimoModelo.ultimoCanal;
    expect(canal.declaracoes).toEqual([
      { fila: 'atualizacoes-projetos', opcoes: { durable: true } },
    ]);
    expect(canal.publicacoes).toHaveLength(1);
    expect(canal.publicacoes[0]).toMatchObject({
      fila: 'atualizacoes-projetos',
      conteudo: envelope,
      propriedades: {
        persistent: true,
        contentType: 'application/json',
        messageId: 'evento-1',
        type: 'CONVITE_ACEITO',
        correlationId: 'req-9',
      },
    });
  });

  it('não preenche o correlationId quando o evento não tem correlação', async () => {
    const { conector, conexao, publicador } = montar();
    await conexao.iniciar();

    await publicador.publicar(atualizacao());

    const [publicacao] = conector.ultimoModelo.ultimoCanal.publicacoes;
    expect(publicacao?.propriedades).not.toHaveProperty('correlationId');
  });

  it('rejeita quando o RabbitMQ está fora do ar, para o chamador tentar de novo', async () => {
    const { conexao, publicador } = montar();

    await expect(publicador.publicar(atualizacao())).rejects.toThrow('RabbitMQ indisponível');

    expect(conexao.conectada).toBe(false);
  });

  it('rejeita quando a publicação não é confirmada', async () => {
    const { conector, conexao, publicador } = montar();
    await conexao.iniciar();
    conector.ultimoModelo.ultimoCanal.falhaConfirmacao = new Error('nack');

    await expect(publicador.publicar(atualizacao())).rejects.toThrow('não confirmou');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { RegistradorCicloVida } from '../../src/application/registrador-ciclo-vida.js';
import {
  ehAtualizacaoProjeto,
  type AtualizacaoProjeto,
} from '../../src/contratos/atualizacoes-projetos.js';
import { ehEventoProjeto, type EventoProjeto } from '../../src/contratos/eventos-projetos.js';
import { FILAS } from '../../src/contratos/mensageria.js';
import { RepositorioProjetos } from '../../src/infrastructure/banco/repositorio-projetos.js';
import { ConexaoRabbitMQ } from '../../src/infrastructure/mensageria/conexao-rabbitmq.js';
import { ConsumidorFila } from '../../src/infrastructure/mensageria/consumidor-fila.js';
import { PublicadorConfirmado } from '../../src/infrastructure/mensageria/publicador-confirmado.js';
import { DADOS_EQUIPE_FORMADA, DADOS_RECOMENDACAO, criarAtualizacao } from './fixtures.js';
import { BancoFalso } from './infrastructure/banco/banco-falso.js';
import {
  CONFIG_RABBITMQ,
  criarConectorFalso,
  criarLoggerFalso,
} from './infrastructure/mensageria/dubles-rabbitmq.js';

async function montar() {
  const conector = criarConectorFalso();
  const { logger, mensagens } = criarLoggerFalso();
  const banco = new BancoFalso();
  const conexao = new ConexaoRabbitMQ(CONFIG_RABBITMQ, logger, {
    intervaloReconexaoMs: 10,
    limiteCanalMs: 50,
    conectar: conector.conectar,
  });
  const repositorio = new RepositorioProjetos(banco);
  const publicador = new PublicadorConfirmado(conexao, logger, { limiteConfirmacaoMs: 50 });
  const consumidor = new ConsumidorFila<AtualizacaoProjeto>(
    conexao,
    {
      fila: FILAS.ATUALIZACOES_PROJETOS,
      prefetch: 1,
      validar: ehAtualizacaoProjeto,
      atrasoNovaTentativaMs: 0,
    },
    logger,
  );
  consumidor.adicionarObservador(new RegistradorCicloVida(repositorio, publicador, logger));
  await conexao.iniciar();
  await consumidor.iniciar();

  const canal = () => conector.ultimoModelo.ultimoCanal;
  const publicados = (): EventoProjeto[] =>
    canal()
      .publicacoes.filter((publicacao) => publicacao.fila === FILAS.EVENTOS_PROJETOS)
      .map((publicacao) => publicacao.conteudo as EventoProjeto);
  const entregar = async (atualizacao: AtualizacaoProjeto, reentregue = false) => {
    const confirmacoesAntes = canal().acks.length + canal().nacks.length;
    canal().entregar(
      FILAS.ATUALIZACOES_PROJETOS,
      atualizacao,
      { messageId: atualizacao.id, type: atualizacao.tipo },
      reentregue,
    );
    await vi.waitFor(() => {
      expect(canal().acks.length + canal().nacks.length).toBe(confirmacoesAntes + 1);
    });
  };

  return { conector, conexao, banco, canal, publicados, entregar, mensagens, consumidor };
}

const RECOMENDACAO = criarAtualizacao('RECOMENDACAO_GERADA', DADOS_RECOMENDACAO);

describe('fluxo atualizacoes-projetos → projetos-db → eventos-projetos', () => {
  it('consome com prefetch 1, registra, publica PROJETO_CRIADO confirmado e faz ack', async () => {
    const { canal, publicados, entregar, banco } = await montar();

    await entregar(RECOMENDACAO);

    expect(canal().prefetches).toEqual([1]);
    expect(canal().acks).toHaveLength(1);
    const [evento] = publicados();
    expect(evento && ehEventoProjeto(evento)).toBe(true);
    expect(evento).toMatchObject({
      tipo: 'PROJETO_CRIADO',
      correlacaoId: 'req-1',
      dados: { motivo: 'RECOMENDACAO_GERADA', projeto: { status: 'CRIADO' } },
    });
    const publicacao = canal().publicacoes.find((item) => item.fila === FILAS.EVENTOS_PROJETOS);
    expect(publicacao?.propriedades).toMatchObject({
      persistent: true,
      messageId: evento?.id,
      type: 'PROJETO_CRIADO',
      correlationId: 'req-1',
    });
    expect(canal().declaracoes).toContainEqual({
      fila: FILAS.EVENTOS_PROJETOS,
      opcoes: { durable: true },
    });
    expect(banco.eventos.get(RECOMENDACAO.id)?.publicado).toBe(true);
  });

  it('não duplica registro nem evento publicado quando a mensagem é reentregue', async () => {
    const { publicados, entregar, banco, canal } = await montar();

    await entregar(RECOMENDACAO);
    await entregar(RECOMENDACAO, true);

    expect(publicados()).toHaveLength(1);
    expect(canal().acks).toHaveLength(2);
    expect(banco.eventos.size).toBe(1);
    expect(banco.projetos.get('projeto-1')?.metricas).toMatchObject({ recomendacoesGeradas: 1 });
  });

  it('com o RabbitMQ sem confirmar, devolve a mensagem e a reentrega republica o mesmo id', async () => {
    const { canal, publicados, entregar, banco } = await montar();
    canal().falhaConfirmacao = new Error('nack do broker');

    await entregar(RECOMENDACAO);

    expect(canal().nacks).toEqual([expect.objectContaining({ requeue: true })]);
    expect(banco.eventos.get(RECOMENDACAO.id)?.publicado).toBe(false);
    const primeiraTentativa = publicados()[0];

    canal().falhaConfirmacao = undefined;
    await entregar(RECOMENDACAO, true);

    expect(publicados()).toHaveLength(2);
    expect(publicados()[1]).toEqual(primeiraTentativa);
    expect(banco.eventos.get(RECOMENDACAO.id)?.publicado).toBe(true);
    expect(banco.eventos.size).toBe(1);
  });

  it('com o PostgreSQL fora do ar, devolve a mensagem sem publicar nada', async () => {
    const { canal, publicados, entregar, banco } = await montar();
    banco.falhaConexao = new Error('connect ECONNREFUSED');

    await entregar(RECOMENDACAO);

    expect(canal().nacks).toEqual([expect.objectContaining({ requeue: true })]);
    expect(publicados()).toHaveLength(0);

    banco.falhaConexao = undefined;
    await entregar(RECOMENDACAO, true);

    expect(publicados()).toHaveLength(1);
    expect(canal().acks).toHaveLength(1);
  });

  it('se a conexão cai durante a publicação, a reentrega após reconectar republica o pendente', async () => {
    const { conector, canal, banco, mensagens, consumidor } = await montar();
    const canalAntigo = canal();
    canalAntigo.confirmacaoTravada = true;

    canalAntigo.entregar(FILAS.ATUALIZACOES_PROJETOS, RECOMENDACAO, {
      messageId: RECOMENDACAO.id,
    });
    await vi.waitFor(() => {
      expect(canalAntigo.publicacoes).toHaveLength(1);
    });
    const emitido = canalAntigo.publicacoes[0]?.conteudo as EventoProjeto;
    conector.ultimoModelo.cair();

    await vi.waitFor(() => {
      expect(conector.modelos).toHaveLength(2);
      expect(consumidor.ativo).toBe(true);
    });
    await vi.waitFor(() => {
      expect(mensagens('error')).toContain('Observador falhou ao tratar a mensagem');
    });
    expect(banco.eventos.get(RECOMENDACAO.id)?.publicado).toBe(false);

    canal().entregar(FILAS.ATUALIZACOES_PROJETOS, RECOMENDACAO, {}, true);
    await vi.waitFor(() => {
      expect(canal().acks).toHaveLength(1);
    });
    expect(canal().publicacoes[0]?.conteudo).toEqual(emitido);
    expect(banco.eventos.get(RECOMENDACAO.id)?.publicado).toBe(true);
  });

  it('percorre o ciclo de vida completo na ordem das mensagens', async () => {
    const { publicados, entregar, banco } = await montar();
    const sequencia = [
      RECOMENDACAO,
      criarAtualizacao('CONVITE_ENVIADO', {}, { ocorridoEm: '2026-11-22T12:01:00.000Z' }),
      criarAtualizacao('CONVITE_ACEITO', {}, { ocorridoEm: '2026-11-22T12:02:00.000Z' }),
      criarAtualizacao('EQUIPE_FORMADA', DADOS_EQUIPE_FORMADA, {
        ocorridoEm: '2026-11-22T12:03:00.000Z',
        projeto: { equipeFormadaId: 'equipe-1' },
      }),
      criarAtualizacao(
        'PAGAMENTO_EFETUADO',
        { valor: 8_000 },
        { ocorridoEm: '2026-11-22T12:04:00.000Z' },
      ),
    ];

    for (const atualizacao of sequencia) {
      await entregar(atualizacao);
    }

    expect(publicados().map((evento) => [evento.tipo, evento.dados.projeto.status])).toEqual([
      ['PROJETO_CRIADO', 'CRIADO'],
      ['PROJETO_ATUALIZADO', 'EM_ANDAMENTO'],
      ['PROJETO_ATUALIZADO', 'EM_ANDAMENTO'],
      ['PROJETO_FINALIZADO', 'FINALIZADO'],
      ['PROJETO_ATUALIZADO', 'FINALIZADO'],
    ]);
    expect(publicados().every(ehEventoProjeto)).toBe(true);
    expect(new Set(publicados().map((evento) => evento.id)).size).toBe(5);
    expect(banco.projetos.get('projeto-1')).toMatchObject({
      status: 'FINALIZADO',
      metricas: expect.objectContaining({
        convites: { enviados: 1, aceitos: 1, recusados: 0, expirados: 0 },
        pagamentos: { efetuados: 1, cancelados: 0, valorTotal: 8_000 },
      }) as unknown,
    });
  });

  it('descarta sem reentrega a mensagem fora do contrato e a que o banco recusa', async () => {
    const { canal, publicados, entregar, mensagens } = await montar();

    await entregar({ ...RECOMENDACAO, versao: 2 } as unknown as AtualizacaoProjeto);
    await entregar(
      criarAtualizacao('RECOMENDACAO_GERADA', {}, { projeto: { titulo: 'x'.repeat(250) } }),
    );

    expect(canal().nacks).toEqual([expect.objectContaining({ requeue: false })]);
    expect(canal().acks).toHaveLength(1);
    expect(publicados()).toHaveLength(0);
    expect(mensagens('warn')).toContain('Mensagem inválida descartada');
    expect(mensagens('error')).toContain(
      'Atualização recusada pelo banco; mensagem descartada para não travar a fila',
    );
  });
});

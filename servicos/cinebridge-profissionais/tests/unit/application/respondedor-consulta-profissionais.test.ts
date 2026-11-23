import { describe, expect, it, vi } from 'vitest';
import type { CadastroProfissionais } from '../../../src/application/ports/cadastro-profissionais.js';
import type {
  MensagemRecebida,
  PropriedadesMensagem,
} from '../../../src/application/ports/observador-mensagem.js';
import {
  CODIGO_CONSULTA_INVALIDA,
  CODIGO_FALHA_CONSULTA,
  MENSAGEM_FALHA_CONSULTA,
  RespondedorConsultaProfissionais,
} from '../../../src/application/respondedor-consulta-profissionais.js';
import {
  ehRespostaProfissionais,
  type RespostaProfissionais,
} from '../../../src/contratos/consulta-profissionais.js';
import { criarEnvelope } from '../../../src/contratos/mensageria.js';
import { gerarCadastro } from '../../../src/infrastructure/banco/gerador-cadastro.js';
import { criarLinhaCompleta, paraLinhaCompleta } from '../helpers-cadastro.js';
import { criarLoggerFalso } from '../infrastructure/mensageria/dubles-rabbitmq.js';

function criarCadastro(sobrescritas: Partial<CadastroProfissionais> = {}) {
  const cadastro = {
    listarAtivos: vi.fn(() =>
      Promise.resolve([criarLinhaCompleta('p1'), criarLinhaCompleta('p2')]),
    ),
    obterPorIds: vi.fn((ids: readonly string[]) =>
      Promise.resolve(ids.map((id) => criarLinhaCompleta(id))),
    ),
    obterPorId: vi.fn(() => Promise.resolve(undefined)),
    listarResumo: vi.fn(() => Promise.resolve([])),
    ...sobrescritas,
  };
  return cadastro satisfies CadastroProfissionais;
}

function montar(cadastro: CadastroProfissionais, falhaPublicacao?: Error) {
  const respostas: { replyTo: string; correlationId: string; corpo: RespostaProfissionais }[] = [];
  const publicador = {
    responder: vi.fn(
      (replyTo: string, correlationId: string, corpo: object, propriedades?: object) => {
        expect(propriedades === undefined || typeof propriedades === 'object').toBe(true);
        if (falhaPublicacao) {
          return Promise.reject(falhaPublicacao);
        }
        respostas.push({ replyTo, correlationId, corpo: corpo as RespostaProfissionais });
        return Promise.resolve();
      },
    ),
  };
  const { logger, mensagens } = criarLoggerFalso();
  let tempo = 0;
  const respondedor = new RespondedorConsultaProfissionais(cadastro, publicador, logger, () => {
    tempo += 25;
    return tempo;
  });
  return { respondedor, publicador, respostas, logger, mensagens };
}

function mensagem(
  conteudo: unknown,
  propriedades: Partial<PropriedadesMensagem> = {
    replyTo: 'resposta.abc',
    correlationId: 'corr-1',
  },
): MensagemRecebida<unknown> {
  return {
    fila: 'consulta-profissionais',
    conteudo,
    propriedades: { headers: {}, ...propriedades },
    reentregue: false,
  };
}

const consultaListar = criarEnvelope(
  'CONSULTA_PROFISSIONAIS',
  { operacao: 'listar-ativos' as const },
  'cinebridge-api',
  { correlacaoId: 'corr-1' },
);

describe('RespondedorConsultaProfissionais', () => {
  it('responde listar-ativos no replyTo com o mesmo correlationId', async () => {
    const cadastro = criarCadastro();
    const { respondedor, respostas, publicador } = montar(cadastro);

    await respondedor.atualizar(mensagem(consultaListar));

    expect(cadastro.listarAtivos).toHaveBeenCalledOnce();
    expect(respostas).toHaveLength(1);
    const [resposta] = respostas;
    expect(resposta?.replyTo).toBe('resposta.abc');
    expect(resposta?.correlationId).toBe('corr-1');
    expect(resposta?.corpo.tipo).toBe('RESPOSTA_PROFISSIONAIS');
    expect(resposta?.corpo.origem).toBe('cinebridge-profissionais');
    expect(resposta?.corpo.correlacaoId).toBe('corr-1');
    expect(resposta?.corpo.dados).toMatchObject({ sucesso: true });
    expect(ehRespostaProfissionais(resposta?.corpo)).toBe(true);
    expect(publicador.responder.mock.calls[0]?.[3]).toEqual({
      messageId: resposta?.corpo.id,
      type: 'RESPOSTA_PROFISSIONAIS',
    });
  });

  it('responde obter-por-ids repassando os ids ao cadastro', async () => {
    const cadastro = criarCadastro();
    const { respondedor, respostas } = montar(cadastro);
    const consulta = criarEnvelope(
      'CONSULTA_PROFISSIONAIS',
      { operacao: 'obter-por-ids' as const, ids: ['a', 'b'] },
      'cinebridge-api',
    );

    await respondedor.atualizar(mensagem(consulta));

    expect(cadastro.obterPorIds).toHaveBeenCalledWith(['a', 'b']);
    const dados = respostas[0]?.corpo.dados;
    expect(dados?.sucesso && dados.profissionais.map((p) => p.id)).toEqual(['a', 'b']);
    expect(respostas[0]?.corpo.correlacaoId).toBe('corr-1');
  });

  it('descarta com aviso a consulta sem replyTo ou sem correlationId', async () => {
    const cadastro = criarCadastro();
    const { respondedor, publicador, mensagens } = montar(cadastro);

    await respondedor.atualizar(mensagem(consultaListar, { correlationId: 'corr-1' }));
    await respondedor.atualizar(mensagem(consultaListar, { replyTo: 'resposta.abc' }));

    expect(publicador.responder).not.toHaveBeenCalled();
    expect(cadastro.listarAtivos).not.toHaveBeenCalled();
    expect(mensagens('warn')).toHaveLength(2);
  });

  it('transforma erro de banco em resposta de falha sem relançar', async () => {
    const cadastro = criarCadastro({
      listarAtivos: () => Promise.reject(new Error('conexão recusada com segredo')),
    });
    const { respondedor, respostas, mensagens } = montar(cadastro);

    await expect(respondedor.atualizar(mensagem(consultaListar))).resolves.toBeUndefined();

    expect(respostas[0]?.corpo.dados).toEqual({
      sucesso: false,
      erro: { codigo: CODIGO_FALHA_CONSULTA, mensagem: MENSAGEM_FALHA_CONSULTA },
    });
    expect(ehRespostaProfissionais(respostas[0]?.corpo)).toBe(true);
    expect(mensagens('error')).toContain('Falha ao consultar o cadastro de profissionais');
  });

  it.each([
    ['operação desconhecida', { ...consultaListar, dados: { operacao: 'apagar-tudo' } }],
    ['sem id', { tipo: 'CONSULTA_PROFISSIONAIS', dados: { operacao: 'listar-ativos' } }],
    ['texto solto', 'lixo'],
    ['ids ausentes', { ...consultaListar, dados: { operacao: 'obter-por-ids' } }],
  ])('responde falha de contrato quando a consulta é inválida (%s)', async (_nome, conteudo) => {
    const cadastro = criarCadastro();
    const { respondedor, respostas } = montar(cadastro);

    await respondedor.atualizar(mensagem(conteudo));

    expect(cadastro.listarAtivos).not.toHaveBeenCalled();
    expect(respostas).toHaveLength(1);
    expect(respostas[0]?.correlationId).toBe('corr-1');
    expect(respostas[0]?.corpo.correlacaoId).toBe('corr-1');
    expect(respostas[0]?.corpo.dados).toMatchObject({
      sucesso: false,
      erro: { codigo: CODIGO_CONSULTA_INVALIDA },
    });
    expect(ehRespostaProfissionais(respostas[0]?.corpo)).toBe(true);
  });

  it('omite o correlacaoId do envelope quando o correlationId excede o limite do contrato', async () => {
    const { respondedor, respostas } = montar(criarCadastro());
    const longo = 'x'.repeat(80);

    await respondedor.atualizar(mensagem('lixo', { replyTo: 'r', correlationId: longo }));

    expect(respostas[0]?.correlationId).toBe(longo);
    expect(respostas[0]?.corpo.correlacaoId).toBeUndefined();
    expect(ehRespostaProfissionais(respostas[0]?.corpo)).toBe(true);
  });

  it('relança a falha de publicação para a mensagem voltar à fila', async () => {
    const { respondedor } = montar(criarCadastro(), new Error('rabbit fora'));

    await expect(respondedor.atualizar(mensagem(consultaListar))).rejects.toThrow('rabbit fora');
  });

  it('loga operação, quantidade e duração', async () => {
    const { respondedor, logger } = montar(criarCadastro());

    await respondedor.atualizar(mensagem(consultaListar));

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        operacao: 'listar-ativos',
        quantidade: 2,
        sucesso: true,
        duracaoMs: 25,
      }),
      expect.stringContaining('listar-ativos'),
    );
  });

  it('responde com 10 mil perfis dentro do contrato e em tempo curto', async () => {
    const linhas = gerarCadastro(10_000, 7).map(paraLinhaCompleta);
    const cadastro = criarCadastro({ listarAtivos: () => Promise.resolve(linhas) });
    const { respondedor, respostas } = montar(cadastro);

    const inicio = performance.now();
    await respondedor.atualizar(mensagem(consultaListar));
    const serializado = JSON.stringify(respostas[0]?.corpo);
    const duracaoMs = performance.now() - inicio;

    expect(duracaoMs).toBeLessThan(10_000);
    expect(Buffer.byteLength(serializado)).toBeLessThan(128 * 1024 * 1024);
    expect(ehRespostaProfissionais(JSON.parse(serializado))).toBe(true);
  }, 60_000);
});

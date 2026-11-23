import { describe, expect, it, vi } from 'vitest';
import {
  TIPO_RESPOSTA_PROFISSIONAIS,
  type ProfissionalCompletoRow,
  type RespostaProfissionais,
  type ResultadoConsultaProfissionais,
} from '../../../src/contratos/consulta-profissionais.js';
import { criarEnvelope } from '../../../src/contratos/mensageria.js';
import { Papel } from '../../../src/domain/enums/papel.js';
import { deProfissionalCompleto } from '../../../src/infrastructure/database/mapeadores.js';
import { ErroMensageria } from '../../../src/infrastructure/mensageria/rabbitmq/conexao-rabbitmq.js';
import {
  CODIGO_CADASTRO_VAZIO,
  CadastroProfissionaisRemoto,
  ErroCadastroRemoto,
  MENSAGEM_CADASTRO_REMOTO,
  MENSAGEM_CADASTRO_VAZIO,
  type SolicitanteConsultaProfissionais,
} from '../../../src/infrastructure/repositories/cadastro-profissionais-remoto.js';
import { RepositorioProfissionaisResiliente } from '../../../src/infrastructure/repositories/repositorio-profissionais-resiliente.js';
import { DisjuntorCircuito } from '../../../src/infrastructure/resiliencia/disjuntor.js';
import { criarAvaliacao, criarProfissional, criarProjeto } from '../../fixtures/dominio.js';

const AGORA = new Date('2026-11-22T12:00:00.000Z');

function perfil(id: string, sobrescritas: Partial<ProfissionalCompletoRow> = {}) {
  return {
    ...deProfissionalCompleto(
      criarProfissional({ id, avaliacoes: [criarAvaliacao({ id: `aval-${id}`, nota: 4 })] }),
    ),
    preco_minimo: '10000.00',
    preco_maximo: '20000.00',
    nota_media: '4.00',
    ...sobrescritas,
  };
}

function resposta(resultado: ResultadoConsultaProfissionais): RespostaProfissionais {
  return criarEnvelope(TIPO_RESPOSTA_PROFISSIONAIS, resultado, 'cinebridge-profissionais');
}

function montar(...respostas: (RespostaProfissionais | Error)[]) {
  const fila = [...respostas];
  const solicitar = vi.fn<SolicitanteConsultaProfissionais['solicitar']>(() => {
    const proxima = fila.shift();
    if (proxima === undefined) {
      return Promise.reject(new Error('nenhuma resposta preparada'));
    }
    return proxima instanceof Error ? Promise.reject(proxima) : Promise.resolve(proxima);
  });
  let sequencia = 0;
  const cadastro = new CadastroProfissionaisRemoto(
    { solicitar },
    {
      gerarId: () => {
        sequencia += 1;
        return `consulta-${sequencia}`;
      },
      agora: () => AGORA,
    },
  );
  return { cadastro, solicitar };
}

describe('CadastroProfissionaisRemoto', () => {
  it('lista os ativos pela consulta listar-ativos e converte os perfis para o domínio', async () => {
    const { cadastro, solicitar } = montar(
      resposta({ sucesso: true, profissionais: [perfil('ana'), perfil('bruno')] }),
    );

    const profissionais = await cadastro.listarAtivos();

    expect(profissionais.map(({ id }) => id)).toEqual(['ana', 'bruno']);
    expect(profissionais[0]?.faixaPreco.minimo).toBe(10_000);
    expect(profissionais[0]?.notaMedia).toBe(4);
    expect(profissionais[0]?.atuaComo(Papel.DIRETOR)).toBe(true);
    expect(profissionais[0]?.disponivelEm(criarProjeto().periodo)).toBe(true);
    expect(solicitar).toHaveBeenCalledWith(
      {
        id: 'consulta-1',
        tipo: 'CONSULTA_PROFISSIONAIS',
        versao: 1,
        ocorridoEm: AGORA.toISOString(),
        origem: 'cinebridge-api',
        dados: { operacao: 'listar-ativos' },
      },
      'listar-ativos',
      { messageId: 'consulta-1' },
    );
  });

  it('não aceita lista vazia como cadastro carregado', async () => {
    const { cadastro } = montar(resposta({ sucesso: true, profissionais: [] }));

    const erro = await cadastro.listarAtivos().catch((falha: unknown) => falha);

    expect(erro).toBeInstanceOf(ErroCadastroRemoto);
    expect(erro).toMatchObject({ codigo: CODIGO_CADASTRO_VAZIO, message: MENSAGEM_CADASTRO_VAZIO });
  });

  it('transforma a resposta sucesso: false em erro com o código do serviço', async () => {
    const { cadastro } = montar(
      resposta({
        sucesso: false,
        erro: { codigo: 'FALHA_CONSULTA_CADASTRO', mensagem: 'banco fora do ar' },
      }),
    );

    await expect(cadastro.listarAtivos()).rejects.toMatchObject({
      name: 'ErroCadastroRemoto',
      codigo: 'FALHA_CONSULTA_CADASTRO',
      message: expect.stringContaining('banco fora do ar') as unknown,
    });
  });

  it('propaga o erro da mensageria quando o serviço não responde', async () => {
    const semResposta = new ErroMensageria('RESPOSTA_NAO_RECEBIDA', 'sem resposta em 15000 ms');
    const { cadastro } = montar(semResposta);

    await expect(cadastro.listarAtivos()).rejects.toBe(semResposta);
  });

  it('obtém por ids sem repetir ids e sem consultar quando a lista é vazia', async () => {
    const { cadastro, solicitar } = montar(
      resposta({ sucesso: true, profissionais: [perfil('ana')] }),
    );

    const vazio = await cadastro.obterPorIds([]);
    const encontrados = await cadastro.obterPorIds(['ana', 'ana', 'sumido']);

    expect(vazio).toEqual(new Map());
    expect([...encontrados.keys()]).toEqual(['ana']);
    expect(solicitar).toHaveBeenCalledTimes(1);
    expect(solicitar.mock.calls[0]?.[0]).toMatchObject({
      dados: { operacao: 'obter-por-ids', ids: ['ana', 'sumido'] },
    });
    expect(solicitar.mock.calls[0]?.[1]).toBe('obter-por-ids');
  });

  it('recusa gravar perfis: o cadastro pertence ao cinebridge-profissionais', async () => {
    const { cadastro, solicitar } = montar();

    await expect(cadastro.salvarTodos()).rejects.toMatchObject({
      codigo: 'OPERACAO_NAO_SUPORTADA',
      message: MENSAGEM_CADASTRO_REMOTO,
    });
    expect(solicitar).not.toHaveBeenCalled();
  });

  it('sem envelope configurado, gera id e instante próprios a cada consulta', async () => {
    const solicitar = vi.fn<SolicitanteConsultaProfissionais['solicitar']>(() =>
      Promise.resolve(resposta({ sucesso: true, profissionais: [perfil('ana')] })),
    );
    const cadastro = new CadastroProfissionaisRemoto({ solicitar });

    await cadastro.listarAtivos();
    await cadastro.listarAtivos();

    const [primeira, segunda] = solicitar.mock.calls.map((chamada) => chamada[0] as { id: string });
    expect(primeira?.id).not.toBe(segunda?.id);
    expect(solicitar.mock.calls[0]?.[2]).toEqual({ messageId: primeira?.id });
  });
});

describe('cache do cadastro abastecido pela fila', () => {
  function criarCache(cadastro: CadastroProfissionaisRemoto) {
    return new RepositorioProfissionaisResiliente(
      { listarAtivos: () => cadastro.listarAtivos() },
      new DisjuntorCircuito({ nome: 'cadastro-profissionais', limiteFalhas: 5, esperaMs: 1_000 }),
      { ttlMs: 60_000, timeoutMs: 1_000 },
    );
  }

  it('enquanto o serviço responde vazio, não aquece e a recomendação sai parcial com o motivo', async () => {
    const { cadastro } = montar(
      resposta({ sucesso: true, profissionais: [] }),
      resposta({ sucesso: true, profissionais: [] }),
      resposta({ sucesso: true, profissionais: [perfil('ana')] }),
    );
    const cache = criarCache(cadastro);

    const aquecido = await cache.aquecer();
    const durante = await cache.buscarCandidatos({
      papeis: [Papel.DIRETOR],
      periodo: criarProjeto().periodo,
      precoMinimoAte: 50_000,
    });
    const depois = await cache.aquecer();

    expect(aquecido).toBe(false);
    expect(durante.profissionais).toEqual([]);
    expect(durante.parcial).toBe(true);
    expect(durante.avisos[0]).toContain('Cadastro de profissionais indisponível');
    expect(durante.avisos[0]).toContain(MENSAGEM_CADASTRO_VAZIO);
    expect(depois).toBe(true);
    expect(cache.estado.profissionaisEmCache).toBe(1);
  });
});

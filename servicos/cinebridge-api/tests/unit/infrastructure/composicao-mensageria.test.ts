import { connect } from 'amqplib';
import { describe, expect, it, vi } from 'vitest';
import { construirApp } from '../../../src/app.js';
import { carregarConfig } from '../../../src/config/config.js';
import { criarContainer } from '../../../src/container.js';
import { TIPO_RESPOSTA_PROFISSIONAIS } from '../../../src/contratos/consulta-profissionais.js';
import { criarEnvelope } from '../../../src/contratos/mensageria.js';
import { deProfissionalCompleto } from '../../../src/infrastructure/database/mapeadores.js';
import { ConexaoRabbitMQ } from '../../../src/infrastructure/mensageria/rabbitmq/conexao-rabbitmq.js';
import { CadastroProfissionaisRemoto } from '../../../src/infrastructure/repositories/cadastro-profissionais-remoto.js';
import { RepositorioProfissionaisMemoria } from '../../../src/infrastructure/repositories/repositorio-profissionais-memoria.js';
import { criarProfissional } from '../../fixtures/dominio.js';
import {
  CONFIG_RABBITMQ,
  criarConectorFalso,
  criarLoggerFalso,
} from './mensageria/rabbitmq/dubles-rabbitmq.js';

vi.mock('amqplib', () => ({ connect: vi.fn() }));

const config = carregarConfig({
  NODE_ENV: 'test',
  DB_USER: 'u',
  DB_PASSWORD: 's',
  DB_NAME: 'b',
  DB_HOST: '127.0.0.1',
  DB_PORT: '1',
  RABBITMQ_HOST: 'cinebridge-mq',
  RABBITMQ_PUBLICACAO_TIMEOUT_MS: '1500',
});

function montarConexaoFalsa() {
  const conector = criarConectorFalso();
  const { logger } = criarLoggerFalso();
  const conexao = new ConexaoRabbitMQ(CONFIG_RABBITMQ, logger, {
    intervaloReconexaoMs: 1_000,
    conectar: conector.conectar,
  });
  return { conector, conexao };
}

describe('composição da mensageria no container', () => {
  it('cria a conexão sem conectar no construtor e a deixa pronta para o servidor iniciar', () => {
    const container = criarContainer(config);

    expect(container.mensageria).toBeInstanceOf(ConexaoRabbitMQ);
    expect(container.mensageria.endereco).toBe('cinebridge-mq:5672');
    expect(container.mensageria.conectada).toBe(false);
    expect(connect).not.toHaveBeenCalled();
  });

  it('usa a conexão injetada pelos testes e liga o verificador e o publicador a ela', async () => {
    const { conector, conexao } = montarConexaoFalsa();
    const container = criarContainer(config, undefined, { conexaoMensageria: conexao });

    expect(container.mensageria).toBe(conexao);
    await expect(container.verificadorRabbitMQ.verificar()).resolves.toBe(false);

    await conexao.iniciar();
    await container.publicadorMensageria.publicar(
      'fila-de-teste',
      { ola: 'mundo' },
      { messageId: 'mensagem-1', type: 'TESTE' },
    );

    await expect(container.verificadorRabbitMQ.verificar()).resolves.toBe(true);
    expect(conector.ultimoModelo.ultimoCanal.publicacoes).toHaveLength(1);
    expect(conector.ultimoModelo.ultimoCanal.publicacoes[0]).toMatchObject({
      fila: 'fila-de-teste',
      conteudo: { ola: 'mundo' },
    });

    await container.encerrar();
  });

  it('declara a saúde com postgres e rabbitmq, sem o cadastro de profissionais', async () => {
    const { conexao } = montarConexaoFalsa();
    const container = criarContainer(config, undefined, { conexaoMensageria: conexao });
    const app = await construirApp(container);

    const fora = await app.inject({ method: 'GET', url: '/health' });
    await conexao.iniciar();
    const comFila = await app.inject({ method: 'GET', url: '/health' });
    await app.close();
    await container.encerrar();

    expect(fora.statusCode).toBe(503);
    expect(fora.json()).toMatchObject({
      status: 'degradado',
      dependencias: { postgres: 'indisponivel', rabbitmq: 'indisponivel' },
    });
    expect(Object.keys(comFila.json<{ dependencias: object }>().dependencias)).toEqual([
      'postgres',
      'rabbitmq',
    ]);
    expect(comFila.statusCode).toBe(503);
    expect(comFila.json()).toMatchObject({ dependencias: { rabbitmq: 'disponivel' } });
  });

  it('consulta o cinebridge-profissionais pela fila consulta-profissionais para aquecer o cache', async () => {
    const { conector, conexao } = montarConexaoFalsa();
    const container = criarContainer(config, undefined, { conexaoMensageria: conexao });
    await conexao.iniciar();
    const canal = conector.ultimoModelo.ultimoCanal;
    canal.aoPublicar = (publicacao) => {
      const perfil = {
        ...deProfissionalCompleto(criarProfissional({ id: 'ana' })),
        preco_minimo: '10000.00',
        preco_maximo: '20000.00',
        nota_media: '0.00',
      };
      canal.entregar(
        String(publicacao.propriedades.replyTo),
        criarEnvelope(
          TIPO_RESPOSTA_PROFISSIONAIS,
          { sucesso: true, profissionais: [perfil] },
          'cinebridge-profissionais',
        ),
        { correlationId: publicacao.propriedades.correlationId },
      );
    };

    const aquecido = await container.cadastroProfissionais.aquecer();
    await container.encerrar();

    const [consulta] = canal.publicacoes;
    expect(container.cadastroInterno).toBeInstanceOf(CadastroProfissionaisRemoto);
    expect(aquecido).toBe(true);
    expect(container.cadastroProfissionais.estado.profissionaisEmCache).toBe(1);
    expect(consulta).toMatchObject({
      fila: 'consulta-profissionais',
      conteudo: {
        tipo: 'CONSULTA_PROFISSIONAIS',
        origem: 'cinebridge-api',
        dados: { operacao: 'listar-ativos' },
      },
      propriedades: {
        type: 'listar-ativos',
        expiration: String(config.resiliencia.cadastroTimeoutMs),
      },
    });
    expect(String(consulta?.propriedades.replyTo)).toMatch(/^consulta-profissionais\.resposta\./);
    expect(canal.filasApagadas).toEqual([consulta?.propriedades.replyTo]);
  });

  it('usa o cadastro injetado pelos testes no lugar da consulta pela fila', async () => {
    const { conector, conexao } = montarConexaoFalsa();
    const cadastro = new RepositorioProfissionaisMemoria([criarProfissional({ id: 'ana' })]);
    const container = criarContainer(config, undefined, {
      conexaoMensageria: conexao,
      cadastroProfissionais: cadastro,
    });
    await conexao.iniciar();

    const aquecido = await container.cadastroProfissionais.aquecer();
    await container.encerrar();

    expect(container.cadastroInterno).toBe(cadastro);
    expect(aquecido).toBe(true);
    expect(conector.ultimoModelo.ultimoCanal.publicacoes).toEqual([]);
  });

  it('fecha a conexão com o RabbitMQ ao encerrar o container', async () => {
    const { conector, conexao } = montarConexaoFalsa();
    const container = criarContainer(config, undefined, { conexaoMensageria: conexao });
    await conexao.iniciar();

    await container.encerrar();

    expect(conexao.encerrada).toBe(true);
    expect(conexao.conectada).toBe(false);
    expect(conector.ultimoModelo.fechado).toBe(true);
  });
});

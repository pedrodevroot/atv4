import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  carregarArquivoEnv,
  carregarConfig,
  ErroConfiguracao,
} from '../../../src/config/config.js';

const obrigatorias = { DB_USER: 'usuario', DB_PASSWORD: 'senha', DB_NAME: 'banco' };

describe('carregarConfig', () => {
  it('aplica valores padrão quando só as variáveis obrigatórias existem', () => {
    const config = carregarConfig(obrigatorias);

    expect(config).toEqual({
      ambiente: 'development',
      servidor: { host: '0.0.0.0', porta: 3000 },
      log: { nivel: 'info' },
      banco: {
        host: 'localhost',
        porta: 5432,
        usuario: 'usuario',
        senha: 'senha',
        nome: 'banco',
        schema: 'public',
        poolMaximo: 30,
        timeoutMs: 5000,
      },
      resiliencia: {
        cacheTtlMs: 300_000,
        cadastroTimeoutMs: 10_000,
        circuitoLimiteFalhas: 3,
        circuitoEsperaMs: 10_000,
      },
      convites: { varreduraMs: 60_000 },
      integracoes: {
        armazenamento: 's3',
        diretorioLocal: join(tmpdir(), 'cinebridge-arquivos'),
        pagamento: 'stripe',
        profissionais: 'interno',
      },
      recomendacao: { decoradores: [], cacheTtlMs: 60_000, cacheMaximo: 500 },
      mensageria: {
        host: 'localhost',
        porta: 5672,
        usuario: 'guest',
        senha: 'guest',
        vhost: '/',
        reconexaoMs: 2_000,
        publicacaoTimeoutMs: 5_000,
      },
    });
  });

  it('lê a conexão com o RabbitMQ das variáveis RABBITMQ_*', () => {
    const config = carregarConfig({
      ...obrigatorias,
      RABBITMQ_HOST: 'cinebridge-mq',
      RABBITMQ_PORT: '5673',
      RABBITMQ_USER: 'cine',
      RABBITMQ_PASSWORD: 'segredo',
      RABBITMQ_VHOST: 'cinebridge',
      RABBITMQ_RECONEXAO_MS: '500',
      RABBITMQ_PUBLICACAO_TIMEOUT_MS: '7000',
    });

    expect(config.mensageria).toEqual({
      host: 'cinebridge-mq',
      porta: 5673,
      usuario: 'cine',
      senha: 'segredo',
      vhost: 'cinebridge',
      reconexaoMs: 500,
      publicacaoTimeoutMs: 7_000,
    });
  });

  it('recusa porta e intervalos de reconexão inválidos do RabbitMQ', () => {
    expect(() => carregarConfig({ ...obrigatorias, RABBITMQ_PORT: '70000' })).toThrow(
      ErroConfiguracao,
    );
    expect(() => carregarConfig({ ...obrigatorias, RABBITMQ_RECONEXAO_MS: '10' })).toThrow(
      ErroConfiguracao,
    );
  });

  it('lê os provedores e a pilha de decoradores das variáveis de ambiente', () => {
    const config = carregarConfig({
      ...obrigatorias,
      ARMAZENAMENTO_PROVEDOR: 'google-cloud',
      PAGAMENTO_PROVEDOR: 'paypal',
      PROFISSIONAIS_PROVEDOR: 'linkedin',
      DECORADORES: 'compressao,cache',
    });

    expect(config.integracoes).toMatchObject({
      armazenamento: 'google-cloud',
      pagamento: 'paypal',
      profissionais: 'linkedin',
    });
    expect(config.recomendacao.decoradores).toEqual(['compressao', 'cache']);
  });

  it('recusa provedor ou decorador desconhecido no boot', () => {
    expect(() => carregarConfig({ ...obrigatorias, PAGAMENTO_PROVEDOR: 'boleto' })).toThrow(
      ErroConfiguracao,
    );
    expect(() => carregarConfig({ ...obrigatorias, DECORADORES: 'cache,magia' })).toThrow(
      ErroConfiguracao,
    );
  });

  it('converte texto das variáveis de ambiente em números', () => {
    const config = carregarConfig({ ...obrigatorias, PORT: '8080', DB_POOL_MAX: '50' });

    expect(config.servidor.porta).toBe(8080);
    expect(config.banco.poolMaximo).toBe(50);
  });

  it('trata variáveis vazias como ausentes', () => {
    const config = carregarConfig({ ...obrigatorias, HOST: '' });

    expect(config.servidor.host).toBe('0.0.0.0');
  });

  it('falha no boot listando todos os problemas encontrados', () => {
    const carregar = () => carregarConfig({ PORT: 'abc', LOG_LEVEL: 'barulhento' });

    expect(carregar).toThrow(ErroConfiguracao);
    try {
      carregar();
    } catch (erro) {
      const problemas = (erro as ErroConfiguracao).problemas;
      expect(problemas.some((problema) => problema.startsWith('PORT'))).toBe(true);
      expect(problemas.some((problema) => problema.startsWith('LOG_LEVEL'))).toBe(true);
      expect(problemas.some((problema) => problema.includes('DB_USER'))).toBe(true);
      expect(new Set(problemas).size).toBe(problemas.length);
    }
  });
});

describe('carregarArquivoEnv', () => {
  const diretorio = mkdtempSync(join(tmpdir(), 'cinebridge-env-'));
  const chave = 'CINEBRIDGE_TESTE_ENV';

  afterEach(() => {
    Reflect.deleteProperty(process.env, chave);
  });

  it('retorna falso quando o arquivo não existe', () => {
    expect(carregarArquivoEnv(join(diretorio, 'inexistente.env'))).toBe(false);
  });

  it('carrega as variáveis do arquivo informado', () => {
    const caminho = join(diretorio, '.env');
    writeFileSync(caminho, `${chave}=carregado\n`);

    expect(carregarArquivoEnv(caminho)).toBe(true);
    expect(process.env[chave]).toBe('carregado');

    rmSync(diretorio, { recursive: true, force: true });
  });
});

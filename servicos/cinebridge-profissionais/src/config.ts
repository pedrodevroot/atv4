import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Type, { type Static } from 'typebox';
import Value from 'typebox/value';

const AMBIENTES = ['development', 'test', 'production'] as const;
const NIVEIS_LOG = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const EsquemaAmbiente = Type.Object({
  NODE_ENV: Type.Enum(AMBIENTES, { default: 'development' }),
  HOST: Type.String({ minLength: 1, default: '0.0.0.0' }),
  PORT: Type.Integer({ minimum: 0, maximum: 65535, default: 3001 }),
  LOG_LEVEL: Type.Enum(NIVEIS_LOG, { default: 'info' }),
  DB_HOST: Type.String({ minLength: 1, default: 'localhost' }),
  DB_PORT: Type.Integer({ minimum: 1, maximum: 65535, default: 5432 }),
  DB_USER: Type.String({ minLength: 1 }),
  DB_PASSWORD: Type.String({ minLength: 1 }),
  DB_NAME: Type.String({ minLength: 1 }),
  DB_POOL_MAX: Type.Integer({ minimum: 1, maximum: 200, default: 10 }),
  DB_TIMEOUT_MS: Type.Integer({ minimum: 100, maximum: 60000, default: 5000 }),
  RABBITMQ_HOST: Type.String({ minLength: 1, default: 'localhost' }),
  RABBITMQ_PORT: Type.Integer({ minimum: 1, maximum: 65535, default: 5672 }),
  RABBITMQ_USER: Type.String({ minLength: 1, default: 'guest' }),
  RABBITMQ_PASSWORD: Type.String({ minLength: 1, default: 'guest' }),
  RABBITMQ_VHOST: Type.String({ minLength: 1, default: '/' }),
  RABBITMQ_PREFETCH: Type.Integer({ minimum: 1, maximum: 1000, default: 4 }),
  RABBITMQ_RECONEXAO_MS: Type.Integer({ minimum: 100, maximum: 600_000, default: 2000 }),
  RABBITMQ_ATRASO_NOVA_TENTATIVA_MS: Type.Integer({
    minimum: 0,
    maximum: 600_000,
    default: 5000,
  }),
  SEED_AO_INICIAR: Type.Boolean({ default: true }),
  SEED_PROFISSIONAIS: Type.Integer({ minimum: 0, maximum: 1_000_000, default: 10_000 }),
  SEED_SEMENTE: Type.Integer({ minimum: 0, default: 2026 }),
});

type Ambiente = Static<typeof EsquemaAmbiente>;

export type NivelLog = (typeof NIVEIS_LOG)[number];

export interface ConfigBanco {
  host: string;
  porta: number;
  usuario: string;
  senha: string;
  nome: string;
  poolMaximo: number;
  timeoutMs: number;
}

export interface ConfigRabbitMQ {
  host: string;
  porta: number;
  usuario: string;
  senha: string;
  vhost: string;
  prefetch: number;
  reconexaoMs: number;
  atrasoNovaTentativaMs: number;
}

export interface ConfigSeed {
  aoIniciar: boolean;
  profissionais: number;
  semente: number;
}

export interface Config {
  ambiente: (typeof AMBIENTES)[number];
  servidor: { host: string; porta: number };
  log: { nivel: NivelLog };
  banco: ConfigBanco;
  rabbitmq: ConfigRabbitMQ;
  seed: ConfigSeed;
}

export class ErroConfiguracao extends Error {
  constructor(readonly problemas: string[]) {
    super(`Configuração inválida: ${problemas.join('; ')}`);
    this.name = 'ErroConfiguracao';
  }
}

export function carregarArquivoEnv(caminho = resolve(process.cwd(), '.env')): boolean {
  if (!existsSync(caminho)) {
    return false;
  }
  process.loadEnvFile(caminho);
  return true;
}

export function carregarConfig(variaveis: NodeJS.ProcessEnv = process.env): Config {
  const entrada = Object.fromEntries(
    Object.keys(EsquemaAmbiente.properties).flatMap((chave) => {
      const valor = variaveis[chave];
      return valor === undefined || valor === '' ? [] : [[chave, valor]];
    }),
  );
  const convertido = Value.Convert(EsquemaAmbiente, Value.Default(EsquemaAmbiente, entrada));

  if (!Value.Check(EsquemaAmbiente, convertido)) {
    const problemas = Value.Errors(EsquemaAmbiente, convertido).map(
      (erro) => `${erro.instancePath.replace('/', '') || 'raiz'}: ${erro.message}`,
    );
    throw new ErroConfiguracao([...new Set(problemas)]);
  }

  return mapearConfig(convertido);
}

function mapearConfig(ambiente: Ambiente): Config {
  return {
    ambiente: ambiente.NODE_ENV,
    servidor: { host: ambiente.HOST, porta: ambiente.PORT },
    log: { nivel: ambiente.LOG_LEVEL },
    banco: {
      host: ambiente.DB_HOST,
      porta: ambiente.DB_PORT,
      usuario: ambiente.DB_USER,
      senha: ambiente.DB_PASSWORD,
      nome: ambiente.DB_NAME,
      poolMaximo: ambiente.DB_POOL_MAX,
      timeoutMs: ambiente.DB_TIMEOUT_MS,
    },
    rabbitmq: {
      host: ambiente.RABBITMQ_HOST,
      porta: ambiente.RABBITMQ_PORT,
      usuario: ambiente.RABBITMQ_USER,
      senha: ambiente.RABBITMQ_PASSWORD,
      vhost: ambiente.RABBITMQ_VHOST,
      prefetch: ambiente.RABBITMQ_PREFETCH,
      reconexaoMs: ambiente.RABBITMQ_RECONEXAO_MS,
      atrasoNovaTentativaMs: ambiente.RABBITMQ_ATRASO_NOVA_TENTATIVA_MS,
    },
    seed: {
      aoIniciar: ambiente.SEED_AO_INICIAR,
      profissionais: ambiente.SEED_PROFISSIONAIS,
      semente: ambiente.SEED_SEMENTE,
    },
  };
}

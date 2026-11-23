import { Pool } from 'pg';
import type { ConfigBanco } from '../../config.js';

export function criarPool(config: ConfigBanco): Pool {
  return new Pool({
    host: config.host,
    port: config.porta,
    user: config.usuario,
    password: config.senha,
    database: config.nome,
    max: config.poolMaximo,
    connectionTimeoutMillis: config.timeoutMs,
  });
}

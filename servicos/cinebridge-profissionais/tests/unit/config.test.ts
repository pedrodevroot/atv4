import { describe, expect, it } from 'vitest';
import { ErroConfiguracao, carregarArquivoEnv, carregarConfig } from '../../src/config.js';

const OBRIGATORIAS = { DB_USER: 'usuario', DB_PASSWORD: 'senha', DB_NAME: 'banco' };

describe('carregarConfig', () => {
  it('aplica os padrões do serviço', () => {
    const config = carregarConfig(OBRIGATORIAS);

    expect(config.servidor.porta).toBe(3001);
    expect(config.rabbitmq).toMatchObject({ host: 'localhost', porta: 5672, prefetch: 4 });
    expect(config.banco).toMatchObject({ usuario: 'usuario', porta: 5432 });
  });

  it('converte números vindos como texto', () => {
    const config = carregarConfig({ ...OBRIGATORIAS, PORT: '4000', DB_PORT: '5433' });

    expect(config.servidor.porta).toBe(4000);
    expect(config.banco.porta).toBe(5433);
  });

  it('rejeita configuração sem as credenciais do banco', () => {
    expect(() => carregarConfig({})).toThrow(ErroConfiguracao);
  });

  it('devolve falso quando o arquivo .env não existe', () => {
    expect(carregarArquivoEnv('caminho/que/nao/existe.env')).toBe(false);
  });
});

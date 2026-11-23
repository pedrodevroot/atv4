import { connect } from 'amqplib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConexaoRabbitMQ,
  DECLARACAO_FILA_DURAVEL,
  DECLARACAO_FILA_RETORNO,
  ErroMensageria,
  descreverErro,
} from '../../../../../src/infrastructure/mensageria/rabbitmq/conexao-rabbitmq.js';
import {
  OPCOES_FILA_DURAVEL,
  OPCOES_FILA_RESPOSTA,
} from '../../../../../src/contratos/mensageria.js';
import {
  CONFIG_RABBITMQ,
  ModeloFalso,
  criarConectorFalso,
  criarLoggerFalso,
  liberarTarefas,
} from './dubles-rabbitmq.js';

vi.mock('amqplib', () => ({ connect: vi.fn() }));

const INTERVALO = 1_000;

function montar(opcoes: { limiteCanalMs?: number; nomeConexao?: string } = {}) {
  const conector = criarConectorFalso();
  const { logger, mensagens } = criarLoggerFalso();
  const conexao = new ConexaoRabbitMQ(
    { ...CONFIG_RABBITMQ, ...(opcoes.nomeConexao ? { nomeConexao: opcoes.nomeConexao } : {}) },
    logger,
    {
      intervaloReconexaoMs: INTERVALO,
      conectar: conector.conectar,
      ...(opcoes.limiteCanalMs === undefined ? {} : { limiteCanalMs: opcoes.limiteCanalMs }),
    },
  );
  return { conector, conexao, logger, mensagens };
}

describe('ConexaoRabbitMQ', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('conecta com a forma de objeto do amqplib e abre um ConfirmChannel', async () => {
    const { conector, conexao, mensagens } = montar({ nomeConexao: 'cinebridge-projetos' });

    await conexao.iniciar();

    expect(conector.chamadas[0]).toEqual({
      opcoes: {
        protocol: 'amqp',
        hostname: 'cinebridge-mq',
        port: 5672,
        username: 'guest',
        password: 'guest',
        vhost: '/',
        heartbeat: 30,
      },
      socket: { timeout: 10_000, clientProperties: { connection_name: 'cinebridge-projetos' } },
    });
    expect(conexao.conectada).toBe(true);
    expect(conexao.endereco).toBe('cinebridge-mq:5672');
    expect(conexao.canalDisponivel).toBe(conector.ultimoModelo.ultimoCanal.canal);
    await expect(conexao.canal()).resolves.toBe(conector.ultimoModelo.ultimoCanal.canal);
    expect(mensagens('info')).toContain('Conectado ao RabbitMQ em cinebridge-mq:5672');
  });

  it('usa heartbeat e tempo limite configurados e não envia nome de conexão quando não há', async () => {
    const conector = criarConectorFalso();
    const conexao = new ConexaoRabbitMQ(
      { ...CONFIG_RABBITMQ, heartbeatS: 10 },
      criarLoggerFalso().logger,
      { conectar: conector.conectar, tempoLimiteConexaoMs: 3_000 },
    );

    await conexao.iniciar();

    expect(conector.chamadas[0]?.opcoes.heartbeat).toBe(10);
    expect(conector.chamadas[0]?.socket).toEqual({ timeout: 3_000 });
  });

  it('usa o connect do amqplib quando nenhuma função de conexão é injetada', async () => {
    const conector = criarConectorFalso();
    vi.mocked(connect).mockImplementation(conector.conectar as unknown as typeof connect);
    const conexao = new ConexaoRabbitMQ(CONFIG_RABBITMQ, criarLoggerFalso().logger);

    await conexao.iniciar();

    expect(connect).toHaveBeenCalledOnce();
    expect(conexao.conectada).toBe(true);
  });

  it('tenta de novo no intervalo configurado até o RabbitMQ aceitar a conexão', async () => {
    const { conector, conexao, mensagens } = montar();
    conector.falharProximas(2);
    let conectou = false;

    const inicio = conexao.iniciar().then(() => {
      conectou = true;
    });
    await liberarTarefas();
    expect(conexao.conectada).toBe(false);
    expect(mensagens('warn')).toEqual([
      'RabbitMQ indisponível em cinebridge-mq:5672; nova tentativa agendada',
    ]);

    await vi.advanceTimersByTimeAsync(INTERVALO);
    expect(conector.conectar).toHaveBeenCalledTimes(2);
    expect(conectou).toBe(false);

    await vi.advanceTimersByTimeAsync(INTERVALO);
    await inicio;
    expect(conector.conectar).toHaveBeenCalledTimes(3);
    expect(conexao.conectada).toBe(true);
    expect(conexao.iniciar()).toBe(conexao.iniciar());
  });

  it('fecha a conexão e tenta de novo quando o canal não abre', async () => {
    const { conector, conexao, mensagens } = montar();
    conector.conectar.mockImplementationOnce(async () => {
      const modelo = new ModeloFalso();
      modelo.falhaCanal = new Error('canal recusado');
      conector.modelos.push(modelo);
      return modelo.modelo;
    });

    const inicio = conexao.iniciar();
    await liberarTarefas();

    expect(conector.modelos[0]?.fechado).toBe(true);
    expect(mensagens('warn')).toContain(
      'Não foi possível abrir o canal do RabbitMQ; nova tentativa agendada',
    );
    await vi.advanceTimersByTimeAsync(INTERVALO);
    await inicio;
    expect(conexao.conectada).toBe(true);
    expect(conector.modelos).toHaveLength(2);
  });

  it('reconecta depois de uma queda e avisa os ouvintes a cada conexão', async () => {
    const { conector, conexao, mensagens } = montar();
    const canais: unknown[] = [];
    conexao.aoConectar(async (canal) => {
      canais.push(canal);
    });
    await conexao.iniciar();
    const primeiro = conector.ultimoModelo;

    primeiro.cair();

    expect(conexao.conectada).toBe(false);
    expect(mensagens('warn')).toContain('Erro na conexão com o RabbitMQ');
    expect(mensagens('warn')).toContain('Conexão com o RabbitMQ perdida; reconectando');
    await vi.advanceTimersByTimeAsync(INTERVALO);

    expect(conexao.conectada).toBe(true);
    expect(conector.ultimoModelo).not.toBe(primeiro);
    expect(canais).toEqual([primeiro.ultimoCanal.canal, conector.ultimoModelo.ultimoCanal.canal]);
    expect(conector.conectar).toHaveBeenCalledTimes(2);
  });

  it('reconstrói a conexão quando só o canal fecha', async () => {
    const { conector, conexao, mensagens } = montar();
    await conexao.iniciar();
    const primeiro = conector.ultimoModelo;

    primeiro.ultimoCanal.emit('error', new Error('PRECONDITION_FAILED'));
    primeiro.ultimoCanal.fechar();
    await liberarTarefas();

    expect(conexao.conectada).toBe(false);
    expect(primeiro.fechado).toBe(true);
    expect(mensagens('warn')).toEqual(
      expect.arrayContaining([
        'Erro no canal do RabbitMQ',
        'Canal do RabbitMQ fechado; reconectando',
      ]),
    );
    await vi.advanceTimersByTimeAsync(INTERVALO);
    expect(conexao.conectada).toBe(true);
    expect(conector.modelos).toHaveLength(2);
  });

  it('registra bloqueio e desbloqueio de publicações', async () => {
    const { conector, conexao, mensagens } = montar();
    await conexao.iniciar();

    conector.ultimoModelo.emit('blocked', 'low on memory');
    conector.ultimoModelo.emit('unblocked');

    expect(mensagens('warn')).toContain('RabbitMQ bloqueou as publicações');
    expect(mensagens('info')).toContain('RabbitMQ liberou as publicações');
  });

  it('faz canal() esperar a reconexão dentro do limite', async () => {
    const { conector, conexao } = montar({ limiteCanalMs: 5_000 });
    await conexao.iniciar();
    conector.ultimoModelo.cair();

    const espera = conexao.canal();
    await vi.advanceTimersByTimeAsync(INTERVALO);

    await expect(espera).resolves.toBe(conector.ultimoModelo.ultimoCanal.canal);
  });

  it('rejeita canal() com RABBITMQ_INDISPONIVEL quando o limite vence', async () => {
    const { conector, conexao } = montar();
    conector.falharProximas(10);
    void conexao.iniciar();

    const espera = conexao.canal(1_500);
    const verificacao = expect(espera).rejects.toMatchObject({
      name: 'ErroMensageria',
      codigo: 'RABBITMQ_INDISPONIVEL',
    });
    await vi.advanceTimersByTimeAsync(1_500);
    await verificacao;
    await expect(conexao.canal(0)).rejects.toBeInstanceOf(ErroMensageria);
    await conexao.encerrar();
  });

  it('continua avisando os demais ouvintes quando um deles falha', async () => {
    const { conexao, mensagens } = montar();
    const segundo = vi.fn(async () => undefined);
    conexao.aoConectar(async () => {
      throw new Error('fila recusada');
    });
    conexao.aoConectar(segundo);

    await conexao.iniciar();

    expect(segundo).toHaveBeenCalledOnce();
    expect(mensagens('error')).toContain('Falha ao preparar o canal do RabbitMQ');
  });

  it('para de avisar o ouvinte removido', async () => {
    const { conector, conexao } = montar();
    const ouvinte = vi.fn(async () => undefined);
    const remover = conexao.aoConectar(ouvinte);
    await conexao.iniciar();

    remover();
    conector.ultimoModelo.cair();
    await vi.advanceTimersByTimeAsync(INTERVALO);

    expect(ouvinte).toHaveBeenCalledOnce();
  });

  it('interrompe os ouvintes de uma conexão que caiu no meio da preparação', async () => {
    const { conector, conexao } = montar();
    const segundo = vi.fn(async () => undefined);
    let quedas = 0;
    conexao.aoConectar(async () => {
      if (quedas === 0) {
        quedas += 1;
        conector.ultimoModelo.cair();
      }
    });
    conexao.aoConectar(segundo);

    void conexao.iniciar();
    await liberarTarefas();

    expect(segundo).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(INTERVALO);
    expect(segundo).toHaveBeenCalledOnce();
    await conexao.encerrar();
  });

  it('encerra: roda as tarefas de encerramento, fecha canal e conexão e não reconecta', async () => {
    const { conector, conexao, mensagens } = montar();
    const ordem: string[] = [];
    conexao.antesDeEncerrar(async () => {
      ordem.push(conexao.conectada ? 'tarefa com canal aberto' : 'tarefa sem canal');
    });
    conexao.antesDeEncerrar(async () => {
      throw new Error('falha ao drenar');
    });
    const removida = vi.fn(async () => undefined);
    conexao.antesDeEncerrar(removida)();
    await conexao.iniciar();
    const modelo = conector.ultimoModelo;

    const encerramento = conexao.encerrar();
    expect(conexao.encerrar()).toBe(encerramento);
    await encerramento;

    expect(ordem).toEqual(['tarefa com canal aberto']);
    expect(removida).not.toHaveBeenCalled();
    expect(modelo.ultimoCanal.fechado).toBe(true);
    expect(modelo.fechado).toBe(true);
    expect(conexao.conectada).toBe(false);
    expect(conexao.encerrada).toBe(true);
    expect(mensagens('warn')).toContain('Falha ao preparar o encerramento da mensageria');
    expect(mensagens('info')).toContain('Conexão com o RabbitMQ encerrada');
    await vi.advanceTimersByTimeAsync(INTERVALO * 5);
    expect(conector.conectar).toHaveBeenCalledOnce();
    await expect(conexao.canal()).rejects.toMatchObject({ codigo: 'RABBITMQ_INDISPONIVEL' });
    await expect(conexao.iniciar()).resolves.toBeUndefined();
  });

  it('encerrar antes de conectar libera o iniciar, rejeita esperas e cancela a nova tentativa', async () => {
    const { conector, conexao } = montar();
    conector.falharProximas(1);
    const inicio = conexao.iniciar();
    await liberarTarefas();
    const espera = conexao.canal(60_000);

    await conexao.encerrar();

    await expect(inicio).resolves.toBeUndefined();
    await expect(espera).rejects.toMatchObject({ codigo: 'RABBITMQ_INDISPONIVEL' });
    await vi.advanceTimersByTimeAsync(INTERVALO * 3);
    expect(conector.conectar).toHaveBeenCalledOnce();
  });

  it('fecha a conexão que termina de abrir depois do encerramento', async () => {
    const { conector, conexao } = montar();
    conector.travar();
    const inicio = conexao.iniciar();
    await liberarTarefas();

    await conexao.encerrar();
    conector.destravar();
    await inicio;
    await liberarTarefas();

    expect(conector.ultimoModelo.fechado).toBe(true);
    expect(conexao.conectada).toBe(false);
  });

  it('fecha o canal que termina de abrir depois do encerramento', async () => {
    const { conector, conexao } = montar();
    let liberarCanal: () => void = () => undefined;
    conector.conectar.mockImplementationOnce(async () => {
      const modelo = new ModeloFalso();
      const abrir = modelo.createConfirmChannel.bind(modelo);
      modelo.createConfirmChannel = async () => {
        await new Promise<void>((resolver) => {
          liberarCanal = resolver;
        });
        return abrir();
      };
      conector.modelos.push(modelo);
      return modelo.modelo;
    });
    void conexao.iniciar();
    await liberarTarefas();

    await conexao.encerrar();
    liberarCanal();
    await liberarTarefas();

    expect(conector.ultimoModelo.ultimoCanal.fechado).toBe(true);
    expect(conexao.conectada).toBe(false);
  });
});

describe('ConexaoRabbitMQ ao fechar recursos', () => {
  it('ignora falhas ao fechar o canal e a conexão no encerramento', async () => {
    const conector = criarConectorFalso();
    const { logger, mensagens } = criarLoggerFalso();
    const conexao = new ConexaoRabbitMQ(CONFIG_RABBITMQ, logger, { conectar: conector.conectar });
    await conexao.iniciar();
    const modelo = conector.ultimoModelo;
    modelo.close = () => Promise.reject(new Error('socket já fechado'));
    modelo.ultimoCanal.close = () => Promise.reject(new Error('canal já fechado'));

    await conexao.encerrar();

    expect(conexao.conectada).toBe(false);
    expect(mensagens('info')).toContain('Conexão com o RabbitMQ encerrada');
  });
});

describe('opções de declaração das filas', () => {
  it('são as mesmas dos contratos', () => {
    expect(DECLARACAO_FILA_DURAVEL).toEqual(OPCOES_FILA_DURAVEL);
    expect(DECLARACAO_FILA_RETORNO).toEqual(OPCOES_FILA_RESPOSTA);
  });
});

describe('descreverErro', () => {
  it('usa a mensagem do Error e converte o resto para texto', () => {
    expect(descreverErro(new Error('falhou'))).toBe('falhou');
    expect(descreverErro('texto')).toBe('texto');
  });
});

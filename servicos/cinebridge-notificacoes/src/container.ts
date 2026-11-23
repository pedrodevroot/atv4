import type { Logger } from 'pino';
import { ListarNotificacoes } from './application/listar-notificacoes.js';
import { NotificadorEmail } from './application/notificador-email.js';
import { NotificadorInterno } from './application/notificador-interno.js';
import { ConsultarSaude } from './application/consultar-saude.js';
import type { VerificadorDependencia } from './application/ports/verificador-dependencia.js';
import type { Config } from './config.js';
import { FILAS } from './contratos/mensageria.js';
import { ehEventoProjeto, type EventoProjeto } from './contratos/eventos-projetos.js';
import { aplicarMigracoes, type Migracao } from './infrastructure/banco/migrador.js';
import { MIGRACOES_NOTIFICACOES } from './infrastructure/banco/migracoes.js';
import { criarPool } from './infrastructure/banco/pool.js';
import { RepositorioNotificacoesPostgres } from './infrastructure/banco/repositorio-notificacoes.js';
import { VerificadorBanco } from './infrastructure/banco/verificador-banco.js';
import { ConexaoRabbitMQ } from './infrastructure/mensageria/conexao-rabbitmq.js';
import { ConsumidorFila } from './infrastructure/mensageria/consumidor-fila.js';
import { VerificadorRabbitMQ } from './infrastructure/mensageria/verificador-rabbitmq.js';

export const NOME_SERVICO = 'cinebridge-notificacoes';
export const MIGRACOES: readonly Migracao[] = MIGRACOES_NOTIFICACOES;

export function criarContainer(config: Config, logger: Logger) {
  const pool = criarPool(config.banco);
  pool.on('error', (erro) => {
    logger.warn({ err: erro }, 'Erro em conexão ociosa do PostgreSQL');
  });

  const conexaoRabbitMQ = new ConexaoRabbitMQ(
    { ...config.rabbitmq, nomeConexao: NOME_SERVICO },
    logger,
    { intervaloReconexaoMs: config.rabbitmq.reconexaoMs },
  );
  const verificadorRabbitMQ = new VerificadorRabbitMQ(conexaoRabbitMQ);

  const repositorioNotificacoes = new RepositorioNotificacoesPostgres(pool);
  const listarNotificacoes = new ListarNotificacoes(repositorioNotificacoes);
  const notificadorEmail = new NotificadorEmail(repositorioNotificacoes, logger);
  const notificadorInterno = new NotificadorInterno(repositorioNotificacoes, logger);

  const consumidorEventos = new ConsumidorFila<EventoProjeto>(
    conexaoRabbitMQ,
    {
      fila: FILAS.EVENTOS_PROJETOS,
      prefetch: config.rabbitmq.prefetch,
      validar: ehEventoProjeto,
      atrasoNovaTentativaMs: config.rabbitmq.atrasoNovaTentativaMs,
    },
    logger,
  );
  consumidorEventos.adicionarObservador(notificadorEmail);
  consumidorEventos.adicionarObservador(notificadorInterno);
  verificadorRabbitMQ.monitorar(consumidorEventos);

  const verificadores: VerificadorDependencia[] = [new VerificadorBanco(pool), verificadorRabbitMQ];
  const consultarSaude = new ConsultarSaude(verificadores);

  return {
    pool,
    conexaoRabbitMQ,
    verificadorRabbitMQ,
    verificadores,
    consultarSaude,
    repositorioNotificacoes,
    listarNotificacoes,
    notificadorEmail,
    notificadorInterno,
    consumidorEventos,
    migrar: () => aplicarMigracoes(pool, MIGRACOES),
    encerrar: async () => {
      await conexaoRabbitMQ.encerrar();
      await pool.end();
    },
  };
}

export type Container = ReturnType<typeof criarContainer>;

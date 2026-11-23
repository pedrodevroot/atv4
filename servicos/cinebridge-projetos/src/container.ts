import type { Logger } from 'pino';
import { ConsultarSaude } from './application/consultar-saude.js';
import type { VerificadorDependencia } from './application/ports/verificador-dependencia.js';
import { RegistradorCicloVida } from './application/registrador-ciclo-vida.js';
import type { Config } from './config.js';
import {
  ehAtualizacaoProjeto,
  type AtualizacaoProjeto,
} from './contratos/atualizacoes-projetos.js';
import { FILAS } from './contratos/mensageria.js';
import { MIGRACOES_PROJETOS } from './infrastructure/banco/migracoes.js';
import { aplicarMigracoes, type Migracao } from './infrastructure/banco/migrador.js';
import { criarPool } from './infrastructure/banco/pool.js';
import { RepositorioProjetos } from './infrastructure/banco/repositorio-projetos.js';
import { VerificadorBanco } from './infrastructure/banco/verificador-banco.js';
import { ConexaoRabbitMQ } from './infrastructure/mensageria/conexao-rabbitmq.js';
import { ConsumidorFila } from './infrastructure/mensageria/consumidor-fila.js';
import { PublicadorConfirmado } from './infrastructure/mensageria/publicador-confirmado.js';
import { VerificadorRabbitMQ } from './infrastructure/mensageria/verificador-rabbitmq.js';

export const NOME_SERVICO = 'cinebridge-projetos';
export const MIGRACOES: readonly Migracao[] = MIGRACOES_PROJETOS;

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

  const repositorioProjetos = new RepositorioProjetos(pool);
  const publicador = new PublicadorConfirmado(conexaoRabbitMQ, logger);
  const registradorCicloVida = new RegistradorCicloVida(repositorioProjetos, publicador, logger);

  const consumidorAtualizacoes = new ConsumidorFila<AtualizacaoProjeto>(
    conexaoRabbitMQ,
    {
      fila: FILAS.ATUALIZACOES_PROJETOS,
      prefetch: config.rabbitmq.prefetch,
      validar: ehAtualizacaoProjeto,
      atrasoNovaTentativaMs: config.rabbitmq.atrasoNovaTentativaMs,
    },
    logger,
  );
  consumidorAtualizacoes.adicionarObservador(registradorCicloVida);
  verificadorRabbitMQ.monitorar(consumidorAtualizacoes);

  const verificadores: VerificadorDependencia[] = [new VerificadorBanco(pool), verificadorRabbitMQ];
  const consultarSaude = new ConsultarSaude(verificadores);

  return {
    pool,
    conexaoRabbitMQ,
    verificadorRabbitMQ,
    verificadores,
    consultarSaude,
    repositorioProjetos,
    publicador,
    registradorCicloVida,
    consumidorAtualizacoes,
    migrar: () => aplicarMigracoes(pool, MIGRACOES),
    iniciarConsumo: () => consumidorAtualizacoes.iniciar(),
    encerrar: async () => {
      await conexaoRabbitMQ.encerrar();
      await pool.end();
    },
  };
}

export type Container = ReturnType<typeof criarContainer>;

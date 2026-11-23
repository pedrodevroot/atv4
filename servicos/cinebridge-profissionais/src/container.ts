import type { Logger } from 'pino';
import { ConsultarSaude } from './application/consultar-saude.js';
import { RespondedorConsultaProfissionais } from './application/respondedor-consulta-profissionais.js';
import type { VerificadorDependencia } from './application/ports/verificador-dependencia.js';
import type { Config } from './config.js';
import { FILAS } from './contratos/mensageria.js';
import { aplicarMigracoes, type Migracao } from './infrastructure/banco/migrador.js';
import { MIGRACAO_CADASTRO_PROFISSIONAIS } from './infrastructure/banco/migracoes.js';
import { criarPool } from './infrastructure/banco/pool.js';
import { RepositorioProfissionais } from './infrastructure/banco/repositorio-profissionais.js';
import { SemeadorProfissionais } from './infrastructure/banco/semeador.js';
import { VerificadorBanco } from './infrastructure/banco/verificador-banco.js';
import { ConexaoRabbitMQ } from './infrastructure/mensageria/conexao-rabbitmq.js';
import { ConsumidorFila } from './infrastructure/mensageria/consumidor-fila.js';
import { PublicadorConfirmado } from './infrastructure/mensageria/publicador-confirmado.js';
import { VerificadorRabbitMQ } from './infrastructure/mensageria/verificador-rabbitmq.js';

export const NOME_SERVICO = 'cinebridge-profissionais';
export const MIGRACOES: readonly Migracao[] = [MIGRACAO_CADASTRO_PROFISSIONAIS];
export const LIMITE_CONFIRMACAO_RESPOSTA_MS = 60_000;

export function aceitarConsulta(valor: unknown): valor is unknown {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

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

  const cadastro = new RepositorioProfissionais(pool);
  const semeador = new SemeadorProfissionais(pool, cadastro, config.seed, logger);
  const publicador = new PublicadorConfirmado(conexaoRabbitMQ, logger, {
    limiteConfirmacaoMs: LIMITE_CONFIRMACAO_RESPOSTA_MS,
  });
  const respondedor = new RespondedorConsultaProfissionais(cadastro, publicador, logger);
  const consumidor = new ConsumidorFila<unknown>(
    conexaoRabbitMQ,
    {
      fila: FILAS.CONSULTA_PROFISSIONAIS,
      prefetch: config.rabbitmq.prefetch,
      validar: aceitarConsulta,
      atrasoNovaTentativaMs: config.rabbitmq.atrasoNovaTentativaMs,
    },
    logger,
  );
  consumidor.adicionarObservador(respondedor);
  verificadorRabbitMQ.monitorar(consumidor);

  const verificadores: VerificadorDependencia[] = [new VerificadorBanco(pool), verificadorRabbitMQ];
  const consultarSaude = new ConsultarSaude(verificadores);

  return {
    pool,
    cadastro,
    semeador,
    respondedor,
    consumidor,
    conexaoRabbitMQ,
    verificadorRabbitMQ,
    verificadores,
    consultarSaude,
    migrar: () => aplicarMigracoes(pool, MIGRACOES),
    semear: () => semeador.executar(),
    iniciarMensageria: async () => {
      await consumidor.iniciar();
      await conexaoRabbitMQ.iniciar();
    },
    encerrar: async () => {
      await conexaoRabbitMQ.encerrar();
      await pool.end();
    },
  };
}

export type Container = ReturnType<typeof criarContainer>;

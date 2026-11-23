import type { PublicadorAtualizacoesProjeto } from '../../src/application/ports/publicador-atualizacoes-projeto.js';
import type { Relogio } from '../../src/application/ports/relogio.js';
import type { AtualizacaoProjeto } from '../../src/contratos/atualizacoes-projetos.js';
import type { OpcoesContainer } from '../../src/container.js';
import type { Profissional } from '../../src/domain/entidades/profissional.js';
import { ConexaoRabbitMQ } from '../../src/infrastructure/mensageria/rabbitmq/conexao-rabbitmq.js';
import { RepositorioProfissionaisMemoria } from '../../src/infrastructure/repositories/repositorio-profissionais-memoria.js';
import {
  CONFIG_RABBITMQ,
  criarConectorFalso,
  criarLoggerFalso,
} from '../unit/infrastructure/mensageria/rabbitmq/dubles-rabbitmq.js';

export function criarMensageriaFalsa(): ConexaoRabbitMQ {
  return new ConexaoRabbitMQ(CONFIG_RABBITMQ, criarLoggerFalso().logger, {
    intervaloReconexaoMs: 1_000,
    conectar: criarConectorFalso().conectar,
  });
}

export class PublicadorAtualizacoesMemoria implements PublicadorAtualizacoesProjeto {
  readonly publicadas: AtualizacaoProjeto[] = [];

  publicar(atualizacao: AtualizacaoProjeto): Promise<void> {
    this.publicadas.push(atualizacao);
    return Promise.resolve();
  }
}

export function opcoesComCadastro(
  cadastro: readonly Profissional[],
  relogio: Relogio,
): OpcoesContainer {
  return {
    relogio,
    cadastroProfissionais: new RepositorioProfissionaisMemoria(cadastro),
    conexaoMensageria: criarMensageriaFalsa(),
    publicadorAtualizacoes: new PublicadorAtualizacoesMemoria(),
  };
}

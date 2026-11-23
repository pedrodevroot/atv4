export interface ConexaoMonitorada {
  readonly conectada: boolean;
}

export interface ConsumidorMonitorado {
  readonly ativo: boolean;
}

export class VerificadorRabbitMQ {
  readonly nome = 'rabbitmq';
  private readonly consumidores: ConsumidorMonitorado[];

  constructor(
    private readonly conexao: ConexaoMonitorada,
    consumidores: readonly ConsumidorMonitorado[] = [],
  ) {
    this.consumidores = [...consumidores];
  }

  monitorar(consumidor: ConsumidorMonitorado): void {
    if (!this.consumidores.includes(consumidor)) {
      this.consumidores.push(consumidor);
    }
  }

  async verificar(): Promise<boolean> {
    return this.conexao.conectada && this.consumidores.every((consumidor) => consumidor.ativo);
  }
}

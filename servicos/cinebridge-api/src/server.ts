import cluster from 'node:cluster';
import { construirApp } from './app.js';
import { carregarArquivoEnv, carregarConfig } from './config/config.js';
import { criarContainer } from './container.js';
import { aquecerComNovasTentativas } from './infrastructure/agendamento/aquecimento-com-novas-tentativas.js';
import { agendarVarredura } from './infrastructure/agendamento/varredura-periodica.js';
import { criarLogger } from './infrastructure/logging/opcoes-logger.js';

carregarArquivoEnv();
const config = carregarConfig();
const logger = criarLogger(config);
const container = criarContainer(config, logger);
const app = await construirApp(container, { logger });

const varreduraConvites = agendarVarredura(
  () => container.casos.expirarConvites.executar({}),
  config.convites.varreduraMs,
  (erro) => {
    app.log.warn({ err: erro }, 'Falha ao expirar convites vencidos');
  },
);

void container.mensageria.iniciar();

const aquecimentoCadastro = aquecerComNovasTentativas(
  () => container.cadastroProfissionais.aquecer(),
  {
    aoFalhar: (tentativa, novaTentativaEmMs) => {
      app.log.info(
        { tentativa, novaTentativaEmMs },
        'Cadastro de profissionais ainda indisponível; nova consulta agendada',
      );
    },
    aoConcluir: (tentativas) => {
      app.log.info({ tentativas }, 'Cache do cadastro aquecido pela fila consulta-profissionais');
    },
  },
);

app.addHook('onClose', async () => {
  varreduraConvites.parar();
  aquecimentoCadastro.parar();
  await container.encerrar();
});

try {
  await container.conexao.garantir();
} catch (erro) {
  app.log.warn({ err: erro }, 'Banco indisponível na inicialização; serviço em modo degradado');
  container.conexao.reconectarEmSegundoPlano({
    aoConectar: () => {
      app.log.info('Conexão com o banco restabelecida');
      return Promise.resolve(true);
    },
  });
}

await app.listen({ host: config.servidor.host, port: config.servidor.porta });

const tomada = cluster.worker?.id ?? 1;
app.log.info({ cena: 1, tomada }, `🎬 Cena 1, tomada ${tomada}: CineBridge no ar!`);

for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sinal, () => {
    app.log.info({ sinal }, 'Encerrando serviço');
    void app.close().then(() => process.exit(0));
  });
}

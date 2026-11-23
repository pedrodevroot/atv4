const env = process.env;

const URLS = {
  api: env.API_URL ?? `http://localhost:${env.API_PORTA ?? 3000}`,
  profissionais: env.PROFISSIONAIS_URL ?? `http://localhost:${env.PROFISSIONAIS_PORTA ?? 3001}`,
  projetos: env.PROJETOS_URL ?? `http://localhost:${env.PROJETOS_PORTA ?? 3002}`,
  notificacoes: env.NOTIFICACOES_URL ?? `http://localhost:${env.NOTIFICACOES_PORTA ?? 3003}`,
  rabbitmq: env.RABBITMQ_API_URL ?? `http://localhost:${env.RABBITMQ_UI_PORTA ?? 15672}`,
};

const RABBITMQ_CREDENCIAIS = {
  usuario: env.RABBITMQ_USER ?? 'guest',
  senha: env.RABBITMQ_PASSWORD ?? 'guest',
  vhost: env.RABBITMQ_VHOST ?? '/',
};

const TEMPOS_MS = {
  saude: Number(env.VERIFICAR_TEMPO_SAUDE_MS ?? 240_000),
  requisicao: Number(env.VERIFICAR_TEMPO_REQUISICAO_MS ?? 120_000),
  consistencia: Number(env.VERIFICAR_TEMPO_CONSISTENCIA_MS ?? 45_000),
  intervalo: Number(env.VERIFICAR_INTERVALO_MS ?? 1_000),
  cacheQuente: Number(env.VERIFICAR_TEMPO_CACHE_MS ?? 180_000),
  intervaloCache: Number(env.VERIFICAR_INTERVALO_CACHE_MS ?? 3_000),
};

const VERIFICAR_CONVITE = (env.VERIFICAR_CONVITE ?? '1') !== '0';

const ROTAS = {
  saude: '/health',
  criarProjeto: '/projetos',
  aceitarMembro: (projetoId, equipeId, papel) =>
    `/projetos/${projetoId}/equipes/${equipeId}/membros/${papel}/aceite`,
  responderConvite: (conviteId) => `/convites/${conviteId}/resposta`,
  profissionaisPorPapel: (papel) => `/profissionais?papel=${papel}&limite=5`,
  projetoPorId: (id) => `/projetos/${id}`,
  notificacoesDoProjeto: (id) => `/notificacoes?projetoId=${encodeURIComponent(id)}&limite=200`,
  filaRabbitmq: (vhost, fila) =>
    `/api/queues/${encodeURIComponent(vhost)}/${encodeURIComponent(fila)}`,
  filasRabbitmq: '/api/queues',
};

const CAMPOS = {
  projetoCriado: { projeto: 'projeto', equipes: 'equipes', membros: 'membros' },
  projetoRegistrado: { status: 'status', metricas: 'metricas', rodadas: 'rodadas' },
  notificacao: {
    canal: 'canal',
    destinatario: 'destinatarioId',
    assunto: 'assunto',
    tipoDestinatario: 'tipoDestinatario',
  },
  eventos: 'eventos',
  listas: ['itens', 'notificacoes', 'profissionais', 'dados', 'resultados'],
};

const ESPERADO = {
  statusProjeto: ['CRIADO', 'EM_ANDAMENTO'],
  canais: ['EMAIL', 'INTERNA'],
  assuntoProjetoRegistrado: /^Projeto registrado/i,
  assuntoInteresseProfissional: /interesse no seu perfil/i,
  assuntoConviteAceito: /^Convite aceito/i,
  papelProfissionais: 'DIRETOR',
  produtorId: 'produtor-1',
  eventoRegistro: 'PROJETO_CRIADO',
  eventosAposAceite: ['PROJETO_ATUALIZADO', 'PROJETO_FINALIZADO'],
};

const FILAS = [
  {
    nome: 'consulta-profissionais',
    requisito: 'R7, R23, R27',
    descricao: 'api publica a consulta, profissionais consome',
  },
  {
    nome: 'atualizacoes-projetos',
    requisito: 'R41',
    descricao: 'api publica o evento, projetos consome',
  },
  {
    nome: 'eventos-projetos',
    requisito: 'R8, R28, R29',
    descricao: 'projetos publica o evento, notificações consome',
  },
];

const PREFIXO_FILA_RESPOSTA = 'consulta-profissionais.resposta.';

const AJUDA = `Verificação ponta a ponta da etapa 7 da ATVIV (CineBridge).

Uso:  node scripts/verificar-stack.mjs [--ajuda]

Pré-requisito: a stack no ar (docker compose up -d --build) e Node 18 ou superior.
Termina com código 0 se todos os passos passaram e 1 se algum falhou.

Variáveis de ambiente (todas opcionais):
  API_URL, PROFISSIONAIS_URL, PROJETOS_URL, NOTIFICACOES_URL, RABBITMQ_API_URL
      URL completa de cada serviço (padrão http://localhost:<porta>)
  API_PORTA, PROFISSIONAIS_PORTA, PROJETOS_PORTA, NOTIFICACOES_PORTA, RABBITMQ_UI_PORTA
      portas do host, as mesmas variáveis do docker-compose.yml
  RABBITMQ_USER, RABBITMQ_PASSWORD, RABBITMQ_VHOST
      credenciais da API de gerenciamento (padrão guest, guest e /)
  VERIFICAR_TEMPO_SAUDE_MS          espera pelos /health (padrão 240000)
  VERIFICAR_TEMPO_REQUISICAO_MS     limite de cada requisição HTTP (padrão 120000)
  VERIFICAR_TEMPO_CONSISTENCIA_MS   espera pelos efeitos assíncronos (padrão 45000)
  VERIFICAR_TEMPO_CACHE_MS          espera o cache de profissionais do api aquecer (padrão 180000)
  VERIFICAR_INTERVALO_CACHE_MS      intervalo entre as tentativas do POST /projetos (padrão 3000)
  VERIFICAR_INTERVALO_MS            intervalo entre tentativas (padrão 1000)
  VERIFICAR_CONVITE=0               pula o passo extra do convite aceito
`;

class PassoPulado extends Error {}

const estado = {
  checagensFalhas: 0,
  projeto: undefined,
  projetoId: undefined,
  produtorId: undefined,
  candidatosIds: new Set(),
  requestId: `verificar-stack-${Date.now()}`,
};

const resultados = [];

function dormir(ms) {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

function mensagemDe(erro) {
  if (erro instanceof Error) {
    const origem = erro.cause;
    const detalhe = origem?.code ?? origem?.errors?.[0]?.code ?? origem?.message ?? '';
    return detalhe ? `${erro.message} (${detalhe})` : erro.message;
  }
  return String(erro);
}

function dizer(prefixo, texto) {
  console.log(`      ${prefixo} ${texto}`);
}

function checar(condicao, descricao, detalhe) {
  if (condicao) {
    dizer('[ok]    ', descricao);
    return true;
  }
  estado.checagensFalhas += 1;
  dizer('[FALHOU]', detalhe ? `${descricao}: ${detalhe}` : descricao);
  return false;
}

async function requisitar(base, caminho, opcoes = {}) {
  const url = `${base}${caminho}`;
  const cabecalhos = { accept: 'application/json', ...(opcoes.cabecalhos ?? {}) };
  const init = { method: opcoes.metodo ?? 'GET', headers: cabecalhos };
  if (opcoes.corpo !== undefined) {
    cabecalhos['content-type'] = 'application/json';
    init.body = JSON.stringify(opcoes.corpo);
  }
  init.signal = AbortSignal.timeout(opcoes.tempoMs ?? TEMPOS_MS.requisicao);
  let resposta;
  try {
    resposta = await fetch(url, init);
  } catch (erro) {
    throw new Error(`${init.method} ${url} sem resposta: ${mensagemDe(erro)}`);
  }
  const texto = await resposta.text();
  let corpo = texto;
  try {
    corpo = texto.length > 0 ? JSON.parse(texto) : undefined;
  } catch {
    corpo = texto;
  }
  return { status: resposta.status, corpo, url, metodo: init.method };
}

function resumirCorpo(corpo) {
  const texto = typeof corpo === 'string' ? corpo : JSON.stringify(corpo);
  if (texto === undefined) return '(vazio)';
  return texto.length > 300 ? `${texto.slice(0, 300)}...` : texto;
}

function exigirStatus(resposta, esperados) {
  const lista = Array.isArray(esperados) ? esperados : [esperados];
  if (!lista.includes(resposta.status)) {
    throw new Error(
      `${resposta.metodo} ${resposta.url} respondeu ${resposta.status} (esperado ${lista.join(' ou ')}): ${resumirCorpo(resposta.corpo)}`,
    );
  }
  return resposta;
}

async function esperarAte(descricao, tentativa, tempoMs = TEMPOS_MS.consistencia) {
  const limite = Date.now() + tempoMs;
  let ultimo = 'nenhuma tentativa concluída';
  let tentativas = 0;
  for (;;) {
    tentativas += 1;
    try {
      const resultado = await tentativa();
      if (resultado.pronto) return resultado.valor;
      ultimo = resultado.motivo ?? 'condição ainda não atendida';
    } catch (erro) {
      ultimo = mensagemDe(erro);
    }
    if (Date.now() >= limite) {
      throw new Error(
        `tempo esgotado (${Math.round(tempoMs / 1000)}s, ${tentativas} tentativas) esperando ${descricao}. Último estado: ${ultimo}`,
      );
    }
    await dormir(TEMPOS_MS.intervalo);
  }
}

function extrairLista(corpo) {
  if (Array.isArray(corpo)) return corpo;
  if (corpo && typeof corpo === 'object') {
    for (const campo of CAMPOS.listas) {
      if (Array.isArray(corpo[campo])) return corpo[campo];
    }
  }
  return undefined;
}

function extrairProjeto(corpo) {
  if (corpo && typeof corpo === 'object' && corpo[CAMPOS.projetoCriado.projeto]) {
    return corpo[CAMPOS.projetoCriado.projeto];
  }
  return corpo;
}

function corpoCriacaoProjeto() {
  return {
    titulo: `Vozes do Sertão (verificação ${new Date().toISOString()})`,
    produtorId: ESPERADO.produtorId,
    genero: 'drama',
    tipoCaptacao: 'FICCAO',
    duracaoMinutos: 95,
    orcamento: 280000,
    dataInicio: '2027-03-01T00:00:00.000Z',
    dataEntrega: '2027-06-30T00:00:00.000Z',
    localizacao: { cidade: 'São Paulo', uf: 'SP', latitude: -23.5505, longitude: -46.6333 },
    requisitos: [
      { papel: 'DIRETOR', peso: 10 },
      { papel: 'DIRETOR_FOTOGRAFIA', peso: 8 },
      { papel: 'ROTEIRISTA', peso: 7 },
      { papel: 'EDITOR', peso: 6 },
      { papel: 'SONOPLASTA', peso: 5 },
      { papel: 'EFEITOS_VISUAIS', peso: 3 },
    ],
    estrategia: 'similaridade-cosseno',
  };
}

function exigirProjeto() {
  if (!estado.projetoId) {
    throw new PassoPulado('o projeto não foi criado no passo 2');
  }
}

async function passo1Saude() {
  const servicos = [
    ['cinebridge-api', URLS.api],
    ['cinebridge-profissionais', URLS.profissionais],
    ['cinebridge-projetos', URLS.projetos],
    ['cinebridge-notificacoes', URLS.notificacoes],
  ];
  for (const [nome, base] of servicos) {
    const relatorio = await esperarAte(
      `${nome} responder 200 em ${base}${ROTAS.saude}`,
      async () => {
        const resposta = await requisitar(base, ROTAS.saude, { tempoMs: 5_000 });
        if (resposta.status !== 200) {
          return {
            pronto: false,
            motivo: `HTTP ${resposta.status}: ${resumirCorpo(resposta.corpo)}`,
          };
        }
        return { pronto: true, valor: resposta.corpo };
      },
      TEMPOS_MS.saude,
    );
    const dependencias = relatorio?.dependencias ?? {};
    checar(
      relatorio?.status === 'ok' &&
        dependencias.postgres === 'disponivel' &&
        dependencias.rabbitmq === 'disponivel',
      `${nome}: /health 200, status ok, postgres e rabbitmq disponíveis`,
      resumirCorpo(relatorio),
    );
  }
  const filas = await requisitar(URLS.rabbitmq, ROTAS.filasRabbitmq, {
    cabecalhos: { authorization: autorizacaoRabbitmq() },
    tempoMs: 10_000,
  }).catch((erro) => ({ status: 0, corpo: mensagemDe(erro) }));
  checar(
    filas.status === 200,
    `RabbitMQ: API de gerenciamento acessível em ${URLS.rabbitmq} com ${RABBITMQ_CREDENCIAIS.usuario}/${RABBITMQ_CREDENCIAIS.senha}`,
    `HTTP ${filas.status}: ${resumirCorpo(filas.corpo)}`,
  );
}

function equipesDe(corpo) {
  const equipes = extrairProjeto(corpo)?.[CAMPOS.projetoCriado.equipes];
  return Array.isArray(equipes) ? equipes : [];
}

async function criarProjetoComEquipes() {
  const limite = Date.now() + TEMPOS_MS.cacheQuente;
  let tentativa = 0;
  let ultimo = 'nenhuma tentativa concluída';
  for (;;) {
    tentativa += 1;
    const requestId = `${estado.requestId}-${tentativa}`;
    let resposta;
    try {
      resposta = await requisitar(URLS.api, ROTAS.criarProjeto, {
        metodo: 'POST',
        corpo: corpoCriacaoProjeto(),
        cabecalhos: { 'x-request-id': requestId },
      });
    } catch (erro) {
      resposta = undefined;
      ultimo = mensagemDe(erro);
    }
    if (resposta) {
      if (resposta.status !== 201 && resposta.status < 500) {
        exigirStatus(resposta, 201);
      }
      if (resposta.status === 201 && equipesDe(resposta.corpo).length >= 1) {
        return { resposta, requestId, tentativa };
      }
      const avisos = resposta.corpo?.avisos;
      ultimo =
        resposta.status === 201
          ? `201 parcial=${resposta.corpo?.parcial} sem equipes; avisos: ${resumirCorpo(avisos)}`
          : `HTTP ${resposta.status}: ${resumirCorpo(resposta.corpo)}`;
      if (resposta.status === 201 && resposta.corpo?.projeto?.id) {
        dizer(
          '[aviso] ',
          `cache ainda frio, tentando de novo (tentativa ${tentativa}, projeto parcial ${resposta.corpo.projeto.id} ignorado): ${resumirCorpo(avisos)}`,
        );
      } else {
        dizer('[aviso] ', `cache ainda frio, tentando de novo (tentativa ${tentativa}): ${ultimo}`);
      }
    } else {
      dizer('[aviso] ', `cache ainda frio, tentando de novo (tentativa ${tentativa}): ${ultimo}`);
    }
    if (Date.now() >= limite) {
      throw new Error(
        `o api não devolveu equipes em ${Math.round(TEMPOS_MS.cacheQuente / 1000)}s (${tentativa} tentativas). Último estado: ${ultimo}`,
      );
    }
    await dormir(TEMPOS_MS.intervaloCache);
  }
}

async function passo2CriarProjeto() {
  const { resposta, requestId, tentativa } = await criarProjetoComEquipes();
  dizer(
    '[ok]    ',
    `POST ${URLS.api}${ROTAS.criarProjeto} respondeu 201 com equipes (tentativa ${tentativa})`,
  );
  const projeto = extrairProjeto(resposta.corpo);
  const equipes = equipesDe(resposta.corpo);
  if (!projeto?.id) {
    throw new Error(`a resposta não traz o id do projeto: ${resumirCorpo(resposta.corpo)}`);
  }
  estado.projeto = projeto;
  estado.projetoId = projeto.id;
  estado.requestId = requestId;
  estado.produtorId = projeto.produtorId ?? ESPERADO.produtorId;
  dizer('[ok]    ', `projeto criado com id ${projeto.id} (x-request-id ${requestId})`);
  checar(equipes.length >= 1, 'a resposta traz equipes sugeridas', resumirCorpo(equipes));
  const membros = equipes.flatMap((equipe) => equipe?.[CAMPOS.projetoCriado.membros] ?? []);
  checar(membros.length >= 1, `as equipes trazem membros (${membros.length} no total)`);
  for (const membro of membros) {
    if (membro?.profissional?.id) estado.candidatosIds.add(membro.profissional.id);
  }
  const ranking = resposta.corpo?.ranking;
  if (ranking && typeof ranking === 'object') {
    for (const candidatos of Object.values(ranking)) {
      for (const candidato of Array.isArray(candidatos) ? candidatos : []) {
        if (candidato?.profissionalId) estado.candidatosIds.add(candidato.profissionalId);
      }
    }
  }
}

async function passo3Profissionais() {
  const resposta = await requisitar(
    URLS.profissionais,
    ROTAS.profissionaisPorPapel(ESPERADO.papelProfissionais),
  );
  exigirStatus(resposta, 200);
  const lista = extrairLista(resposta.corpo);
  checar(
    Array.isArray(lista) && lista.length >= 1,
    `GET ${URLS.profissionais}${ROTAS.profissionaisPorPapel(ESPERADO.papelProfissionais)} devolve profissionais do próprio profissionais-db`,
    resumirCorpo(resposta.corpo),
  );
}

async function passo4ProjetoRegistrado() {
  exigirProjeto();
  const registro = await esperarAte(
    `o projeto ${estado.projetoId} aparecer em ${URLS.projetos}`,
    async () => {
      const resposta = await requisitar(URLS.projetos, ROTAS.projetoPorId(estado.projetoId));
      if (resposta.status !== 200) {
        return {
          pronto: false,
          motivo: `HTTP ${resposta.status}: ${resumirCorpo(resposta.corpo)}`,
        };
      }
      const projeto = extrairProjeto(resposta.corpo);
      const rodadas =
        projeto?.[CAMPOS.projetoRegistrado.metricas]?.[CAMPOS.projetoRegistrado.rodadas];
      if (typeof rodadas !== 'number' || rodadas < 1) {
        return { pronto: false, motivo: `registro sem métricas ainda: ${resumirCorpo(projeto)}` };
      }
      if (!eventoPublicado(projeto, [ESPERADO.eventoRegistro])) {
        return {
          pronto: false,
          motivo: `ainda sem ${ESPERADO.eventoRegistro} publicado em eventos: ${resumirCorpo(projeto[CAMPOS.eventos])}`,
        };
      }
      return { pronto: true, valor: projeto };
    },
  );
  dizer(
    '[ok]    ',
    `GET ${URLS.projetos}${ROTAS.projetoPorId(estado.projetoId)} devolve o registro`,
  );
  const status = registro[CAMPOS.projetoRegistrado.status];
  const metricas = registro[CAMPOS.projetoRegistrado.metricas];
  checar(
    ESPERADO.statusProjeto.includes(status),
    `status do projeto é ${ESPERADO.statusProjeto.join(' ou ')} (recebido ${status})`,
  );
  checar(
    eventoPublicado(registro, [ESPERADO.eventoRegistro]),
    `o registro tem o evento ${ESPERADO.eventoRegistro} publicado em eventos-projetos`,
  );
  checar(metricas.rodadas >= 1, `métricas.rodadas >= 1 (recebido ${metricas.rodadas})`);
  checar(
    metricas.recomendacoesGeradas >= 1,
    `métricas.recomendacoesGeradas >= 1 (recebido ${metricas.recomendacoesGeradas})`,
  );
}

function eventoPublicado(projeto, tipos) {
  const eventos = projeto?.[CAMPOS.eventos];
  return (
    Array.isArray(eventos) &&
    eventos.some(
      (evento) => tipos.includes(evento?.eventoSaida?.tipo) && evento?.publicado === true,
    )
  );
}

function resumirNotificacoes(lista) {
  const campos = CAMPOS.notificacao;
  return lista.map(
    (aviso) => `${aviso[campos.canal]}:${aviso[campos.destinatario]}:${aviso[campos.assunto]}`,
  );
}

async function buscarNotificacoes() {
  const resposta = await requisitar(
    URLS.notificacoes,
    ROTAS.notificacoesDoProjeto(estado.projetoId),
  );
  if (resposta.status !== 200) {
    throw new Error(`HTTP ${resposta.status}: ${resumirCorpo(resposta.corpo)}`);
  }
  const lista = extrairLista(resposta.corpo);
  if (!lista) {
    throw new Error(`resposta sem lista de notificações: ${resumirCorpo(resposta.corpo)}`);
  }
  return lista;
}

function pendenciasDeNotificacao(lista) {
  const campos = CAMPOS.notificacao;
  const faltando = [];
  const canais = new Set(lista.map((aviso) => aviso[campos.canal]));
  for (const canal of ESPERADO.canais) {
    if (!canais.has(canal)) faltando.push(`aviso no canal ${canal}`);
  }
  const doProdutor = lista.filter((aviso) => aviso[campos.destinatario] === estado.produtorId);
  if (
    !doProdutor.some((aviso) => ESPERADO.assuntoProjetoRegistrado.test(aviso[campos.assunto] ?? ''))
  ) {
    faltando.push(`aviso "Projeto registrado" ao produtor ${estado.produtorId}`);
  }
  const doProfissional = lista.filter(
    (aviso) =>
      aviso[campos.destinatario] !== estado.produtorId &&
      ESPERADO.assuntoInteresseProfissional.test(aviso[campos.assunto] ?? ''),
  );
  if (doProfissional.length === 0) {
    faltando.push('aviso "interesse no seu perfil" a algum profissional sugerido');
  }
  return faltando;
}

async function passo5Notificacoes() {
  exigirProjeto();
  const campos = CAMPOS.notificacao;
  const lista = await esperarAte(
    `os avisos do projeto ${estado.projetoId} em ${URLS.notificacoes}`,
    async () => {
      const avisos = await buscarNotificacoes();
      const faltando = pendenciasDeNotificacao(avisos);
      return faltando.length === 0
        ? { pronto: true, valor: avisos }
        : { pronto: false, motivo: `${avisos.length} avisos, faltando: ${faltando.join('; ')}` };
    },
  );
  dizer(
    '[ok]    ',
    `GET ${URLS.notificacoes}${ROTAS.notificacoesDoProjeto(estado.projetoId)} devolve ${lista.length} avisos`,
  );
  for (const canal of ESPERADO.canais) {
    const total = lista.filter((aviso) => aviso[campos.canal] === canal).length;
    checar(total >= 1, `${total} avisos no canal ${canal}`);
  }
  checar(
    lista.some(
      (aviso) =>
        aviso[campos.destinatario] === estado.produtorId &&
        ESPERADO.assuntoProjetoRegistrado.test(aviso[campos.assunto] ?? ''),
    ),
    `o produtor ${estado.produtorId} recebeu "Projeto registrado"`,
  );
  const interessados = lista.filter(
    (aviso) =>
      aviso[campos.destinatario] !== estado.produtorId &&
      ESPERADO.assuntoInteresseProfissional.test(aviso[campos.assunto] ?? ''),
  );
  const destinatarios = new Set(interessados.map((aviso) => aviso[campos.destinatario]));
  checar(
    destinatarios.size >= 1,
    `${destinatarios.size} profissionais sugeridos foram avisados ("interesse no seu perfil")`,
  );
  if (estado.candidatosIds.size > 0) {
    const reconhecidos = [...destinatarios].filter((id) => estado.candidatosIds.has(id));
    checar(
      reconhecidos.length >= 1,
      'os avisados são profissionais que aparecem na recomendação devolvida pelo api',
      `avisados: ${[...destinatarios].slice(0, 3).join(', ')}`,
    );
  }
}

async function passo6ConviteAceito() {
  exigirProjeto();
  if (!VERIFICAR_CONVITE) {
    throw new PassoPulado('desativado por VERIFICAR_CONVITE=0');
  }
  const equipe = estado.projeto?.[CAMPOS.projetoCriado.equipes]?.[0];
  const membros = equipe?.[CAMPOS.projetoCriado.membros] ?? [];
  const membro = membros.find((item) => item?.papel === ESPERADO.papelProfissionais) ?? membros[0];
  if (!equipe?.id || !membro?.papel) {
    throw new Error('a equipe sugerida não traz id ou membros para o aceite');
  }
  const aceite = exigirStatus(
    await requisitar(URLS.api, ROTAS.aceitarMembro(estado.projetoId, equipe.id, membro.papel), {
      metodo: 'POST',
      cabecalhos: { 'x-request-id': estado.requestId },
    }),
    [200, 201],
  );
  const conviteId = aceite.corpo?.convite?.id;
  if (!conviteId) {
    throw new Error(`o aceite não devolveu o convite: ${resumirCorpo(aceite.corpo)}`);
  }
  dizer(
    '[ok]    ',
    `produtor aceitou o ${membro.papel} sugerido e o convite ${conviteId} foi criado`,
  );
  exigirStatus(
    await requisitar(URLS.api, ROTAS.responderConvite(conviteId), {
      metodo: 'POST',
      corpo: { aceito: true },
      cabecalhos: { 'x-request-id': estado.requestId },
    }),
    200,
  );
  dizer('[ok]    ', `profissional aceitou o convite ${conviteId}`);
  const campos = CAMPOS.notificacao;
  await esperarAte('o aviso "Convite aceito" ao produtor', async () => {
    const avisos = await buscarNotificacoes();
    const achou = avisos.some(
      (aviso) =>
        aviso[campos.destinatario] === estado.produtorId &&
        ESPERADO.assuntoConviteAceito.test(aviso[campos.assunto] ?? ''),
    );
    return achou
      ? { pronto: true, valor: avisos }
      : { pronto: false, motivo: `avisos atuais: ${resumirNotificacoes(avisos).join(' | ')}` };
  });
  dizer(
    '[ok]    ',
    `o produtor ${estado.produtorId} recebeu "Convite aceito para ${membro.papel}"`,
  );
  const registro = await esperarAte(
    'métricas.convites.aceitos >= 1 e o evento PROJETO_ATUALIZADO publicado no projetos',
    async () => {
      const resposta = await requisitar(URLS.projetos, ROTAS.projetoPorId(estado.projetoId));
      const projeto = extrairProjeto(resposta.corpo);
      const aceitos = projeto?.metricas?.convites?.aceitos;
      return typeof aceitos === 'number' &&
        aceitos >= 1 &&
        eventoPublicado(projeto, ESPERADO.eventosAposAceite)
        ? { pronto: true, valor: projeto }
        : { pronto: false, motivo: `métricas: ${resumirCorpo(projeto?.metricas)}` };
    },
  );
  dizer(
    '[ok]    ',
    `projetos registrou ${registro.metricas.convites.aceitos} convite(s) aceito(s)`,
  );
}

function autorizacaoRabbitmq() {
  const credencial = `${RABBITMQ_CREDENCIAIS.usuario}:${RABBITMQ_CREDENCIAIS.senha}`;
  return `Basic ${Buffer.from(credencial).toString('base64')}`;
}

async function consultarFila(nome) {
  const resposta = await requisitar(
    URLS.rabbitmq,
    ROTAS.filaRabbitmq(RABBITMQ_CREDENCIAIS.vhost, nome),
    { cabecalhos: { authorization: autorizacaoRabbitmq() }, tempoMs: 10_000 },
  );
  if (resposta.status === 401) {
    throw new Error(`credenciais recusadas (${RABBITMQ_CREDENCIAIS.usuario}/***)`);
  }
  if (resposta.status === 404) {
    throw new Error(`a fila ${nome} não existe`);
  }
  if (resposta.status !== 200) {
    throw new Error(`HTTP ${resposta.status}: ${resumirCorpo(resposta.corpo)}`);
  }
  return resposta.corpo;
}

async function passo7FilasRabbitmq() {
  for (const fila of FILAS) {
    const dados = await esperarAte(
      `a fila ${fila.nome} mostrar consumidor e publicações no RabbitMQ`,
      async () => {
        const corpo = await consultarFila(fila.nome);
        const publicadas = corpo?.message_stats?.publish ?? 0;
        const consumidores = corpo?.consumers ?? 0;
        if (consumidores < 1 || publicadas < 1) {
          return {
            pronto: false,
            motivo: `consumers=${consumidores}, message_stats.publish=${publicadas}`,
          };
        }
        return { pronto: true, valor: corpo };
      },
    );
    dizer('[ok]    ', `${fila.nome} (${fila.descricao}; ${fila.requisito})`);
    checar(dados.durable === true, `${fila.nome}: durable = true`, `durable=${dados.durable}`);
    checar(dados.consumers >= 1, `${fila.nome}: consumers = ${dados.consumers}`);
    checar(
      dados.message_stats.publish >= 1,
      `${fila.nome}: message_stats.publish = ${dados.message_stats.publish}`,
    );
    const entregues = dados.message_stats.ack ?? 0;
    dizer(
      '[info]  ',
      `${fila.nome}: prontas=${dados.messages_ready ?? 0}, não confirmadas=${dados.messages_unacknowledged ?? 0}, ack=${entregues}`,
    );
  }
  const todas = await requisitar(URLS.rabbitmq, ROTAS.filasRabbitmq, {
    cabecalhos: { authorization: autorizacaoRabbitmq() },
    tempoMs: 10_000,
  }).catch(() => undefined);
  if (todas && todas.status === 200 && Array.isArray(todas.corpo)) {
    const sobras = todas.corpo
      .map((fila) => fila.name)
      .filter((nome) => typeof nome === 'string' && nome.startsWith(PREFIXO_FILA_RESPOSTA));
    dizer(
      sobras.length === 0 ? '[ok]    ' : '[aviso] ',
      sobras.length === 0
        ? 'nenhuma fila de retorno esquecida (consulta-profissionais.resposta.*)'
        : `${sobras.length} fila(s) de retorno ainda existem: ${sobras.slice(0, 3).join(', ')}`,
    );
  }
}

const PASSOS = [
  {
    titulo: 'Os quatro serviços e o RabbitMQ estão saudáveis',
    requisitos: 'R1, R31, R37',
    executar: passo1Saude,
  },
  {
    titulo: 'POST /projetos no cinebridge-api: a recomendação é processada (201 com equipes)',
    requisitos: 'R2, R36 (recomendação processada)',
    executar: passo2CriarProjeto,
  },
  {
    titulo: 'cinebridge-profissionais responde com dados do próprio banco',
    requisitos: 'R3, R9, R36 (profissionais)',
    executar: passo3Profissionais,
  },
  {
    titulo: 'cinebridge-projetos registrou o projeto, com status e métricas',
    requisitos: 'R4, R8, R36 (projeto registrado)',
    executar: passo4ProjetoRegistrado,
  },
  {
    titulo: 'cinebridge-notificacoes enviou avisos nos canais EMAIL e INTERNA',
    requisitos: 'R5, R29, R36 (notificações enviadas), R40',
    executar: passo5Notificacoes,
  },
  {
    titulo: 'Convite aceito percorre api, projetos e notificações (passo extra)',
    requisitos: 'R5 (aceitação de um convite), R8',
    executar: passo6ConviteAceito,
  },
  {
    titulo: 'Filas no RabbitMQ: duráveis, com consumidor e tráfego',
    requisitos: 'R7, R23, R26, R36 (via RabbitMQ), R37, R41',
    executar: passo7FilasRabbitmq,
  },
];

async function executarPasso(indice, passo) {
  const numero = indice + 1;
  console.log(`\n[${numero}/${PASSOS.length}] ${passo.titulo}`);
  console.log(`      cobre: ${passo.requisitos}`);
  const inicio = Date.now();
  const falhasAntes = estado.checagensFalhas;
  let situacao = 'PASSOU';
  let motivo = '';
  try {
    await passo.executar();
    if (estado.checagensFalhas > falhasAntes) {
      situacao = 'FALHOU';
      motivo = `${estado.checagensFalhas - falhasAntes} verificação(ões) reprovada(s)`;
    }
  } catch (erro) {
    if (erro instanceof PassoPulado) {
      situacao = 'PULADO';
      motivo = erro.message;
    } else {
      situacao = 'FALHOU';
      motivo = mensagemDe(erro);
    }
  }
  const segundos = ((Date.now() - inicio) / 1000).toFixed(1);
  if (situacao === 'PASSOU') console.log(`      => PASSOU (${segundos}s)`);
  else if (situacao === 'PULADO') console.log(`      => PULADO: ${motivo}`);
  else console.log(`      => FALHOU (${segundos}s): ${motivo}`);
  resultados.push({ numero, titulo: passo.titulo, situacao, motivo, segundos });
}

function imprimirResumo() {
  console.log('\n==================== Resumo ====================');
  for (const item of resultados) {
    const rotulo = item.situacao.padEnd(6);
    const detalhe = item.situacao === 'PASSOU' ? '' : ` -> ${item.motivo}`;
    console.log(`${rotulo}  ${item.numero}. ${item.titulo}${detalhe}`);
  }
  const falhou = resultados.filter((item) => item.situacao === 'FALHOU').length;
  const passou = resultados.filter((item) => item.situacao === 'PASSOU').length;
  const pulados = resultados.filter((item) => item.situacao === 'PULADO').length;
  console.log(`\n${passou} passaram, ${falhou} falharam, ${pulados} pulados.`);
  if (estado.projetoId) {
    console.log(`Projeto verificado: ${estado.projetoId} (x-request-id ${estado.requestId})`);
  }
  console.log(
    `Interface do RabbitMQ: ${URLS.rabbitmq} (${RABBITMQ_CREDENCIAIS.usuario}/${RABBITMQ_CREDENCIAIS.senha})`,
  );
  console.log('Logs dos serviços: docker compose logs -f   (ou docker-compose logs -f)');
  if (falhou > 0) {
    console.log('\nRESULTADO: FALHOU');
    return 1;
  }
  console.log('\nRESULTADO: PASSOU');
  return 0;
}

async function principal() {
  if (process.argv.includes('--ajuda') || process.argv.includes('-h')) {
    console.log(AJUDA);
    return 0;
  }
  const [maior] = process.versions.node.split('.').map(Number);
  if (maior < 18) {
    console.error(`Node ${process.versions.node} não tem fetch: use Node 18 ou superior.`);
    return 1;
  }
  console.log('Verificação ponta a ponta da stack CineBridge (etapa 7 da ATVIV)');
  console.log(
    `api ${URLS.api} | profissionais ${URLS.profissionais} | projetos ${URLS.projetos} | notificações ${URLS.notificacoes} | rabbitmq ${URLS.rabbitmq}`,
  );
  for (const [indice, passo] of PASSOS.entries()) {
    await executarPasso(indice, passo);
  }
  return imprimirResumo();
}

principal().then(
  (codigo) => {
    process.exitCode = codigo;
  },
  (erro) => {
    console.error(`Erro inesperado: ${mensagemDe(erro)}`);
    process.exitCode = 1;
  },
);

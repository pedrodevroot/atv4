import { describe, expect, it } from 'vitest';
import { TIPOS_EVENTO_API } from '../../../src/contratos/atualizacoes-projetos.js';
import { MOTIVOS_NOTIFICAVEIS, comporAvisos } from '../../../src/domain/compositor-notificacoes.js';
import { DETALHES_POR_MOTIVO, criarEventoProjeto } from '../fixtures/eventos-projetos.js';

describe('comporAvisos por motivo (mesmos textos do compositor do api)', () => {
  it('RECOMENDACAO_GERADA avisa cada profissional recomendado', () => {
    const avisos = comporAvisos(
      criarEventoProjeto({
        motivo: 'RECOMENDACAO_GERADA',
        detalhe: DETALHES_POR_MOTIVO.RECOMENDACAO_GERADA,
      }),
    );

    expect(avisos).toEqual([
      {
        destinatarioId: 'prof-1',
        tipoDestinatario: 'PROFISSIONAL',
        assunto: 'Um produtor tem interesse no seu perfil',
        corpo: 'Você foi recomendado(a) como DIRETOR para o projeto projeto-1.',
      },
      {
        destinatarioId: 'prof-2',
        tipoDestinatario: 'PROFISSIONAL',
        assunto: 'Um produtor tem interesse no seu perfil',
        corpo: 'Você foi recomendado(a) como EDITOR para o projeto projeto-1.',
      },
    ]);
  });

  it('CONVITE_ENVIADO avisa o profissional convidado', () => {
    const avisos = comporAvisos(
      criarEventoProjeto({
        motivo: 'CONVITE_ENVIADO',
        detalhe: DETALHES_POR_MOTIVO.CONVITE_ENVIADO,
      }),
    );

    expect(avisos).toEqual([
      {
        destinatarioId: 'prof-1',
        tipoDestinatario: 'PROFISSIONAL',
        assunto: 'Convite para atuar como DIRETOR',
        corpo:
          'Você foi convidado(a) para o projeto projeto-1. Responda até 2026-11-29T12:00:00.000Z.',
      },
    ]);
  });

  it('CONVITE_ACEITO avisa o produtor', () => {
    const avisos = comporAvisos(
      criarEventoProjeto({
        motivo: 'CONVITE_ACEITO',
        detalhe: DETALHES_POR_MOTIVO.CONVITE_ACEITO,
      }),
    );

    expect(avisos).toEqual([
      {
        destinatarioId: 'produtor-1',
        tipoDestinatario: 'PRODUTOR',
        assunto: 'Convite aceito para DIRETOR',
        corpo: 'O profissional prof-1 aceitou o convite do projeto projeto-1.',
      },
    ]);
  });

  it('CONVITE_RECUSADO avisa o produtor', () => {
    const avisos = comporAvisos(
      criarEventoProjeto({
        motivo: 'CONVITE_RECUSADO',
        detalhe: DETALHES_POR_MOTIVO.CONVITE_RECUSADO,
      }),
    );

    expect(avisos).toEqual([
      {
        destinatarioId: 'produtor-1',
        tipoDestinatario: 'PRODUTOR',
        assunto: 'Convite recusado para DIRETOR',
        corpo:
          'O profissional prof-1 recusou o convite. O sistema vai buscar um substituto para DIRETOR.',
      },
    ]);
  });

  it('CONVITE_EXPIRADO avisa o produtor e o profissional', () => {
    const avisos = comporAvisos(
      criarEventoProjeto({
        motivo: 'CONVITE_EXPIRADO',
        detalhe: DETALHES_POR_MOTIVO.CONVITE_EXPIRADO,
      }),
    );

    expect(avisos).toEqual([
      {
        destinatarioId: 'produtor-1',
        tipoDestinatario: 'PRODUTOR',
        assunto: 'Convite expirado para DIRETOR',
        corpo:
          'O profissional prof-1 não respondeu ao convite do projeto projeto-1 no prazo. O sistema vai buscar um substituto para DIRETOR.',
      },
      {
        destinatarioId: 'prof-1',
        tipoDestinatario: 'PROFISSIONAL',
        assunto: 'Convite expirado para DIRETOR',
        corpo: 'O prazo para responder ao convite do projeto projeto-1 terminou.',
      },
    ]);
  });

  it('SUBSTITUICAO_INDISPONIVEL avisa o produtor com o motivo informado', () => {
    const avisos = comporAvisos(
      criarEventoProjeto({
        motivo: 'SUBSTITUICAO_INDISPONIVEL',
        detalhe: DETALHES_POR_MOTIVO.SUBSTITUICAO_INDISPONIVEL,
      }),
    );

    expect(avisos).toEqual([
      {
        destinatarioId: 'produtor-1',
        tipoDestinatario: 'PRODUTOR',
        assunto: 'Sem substituto automático para DIRETOR',
        corpo:
          'Não foi possível iniciar a nova rodada para DIRETOR no projeto projeto-1: Não há candidatos disponíveis. Escolha um substituto ou ajuste o projeto.',
      },
    ]);
  });

  it('EQUIPE_FORMADA avisa o produtor e cada membro', () => {
    const avisos = comporAvisos(
      criarEventoProjeto({
        tipo: 'PROJETO_FINALIZADO',
        status: 'FINALIZADO',
        motivo: 'EQUIPE_FORMADA',
        detalhe: DETALHES_POR_MOTIVO.EQUIPE_FORMADA,
      }),
    );

    expect(avisos).toEqual([
      {
        destinatarioId: 'produtor-1',
        tipoDestinatario: 'PRODUTOR',
        assunto: 'Equipe formada',
        corpo: 'A equipe do projeto projeto-1 foi formada com 2 membros.',
      },
      {
        destinatarioId: 'prof-1',
        tipoDestinatario: 'PROFISSIONAL',
        assunto: 'Equipe formada',
        corpo: 'Você faz parte da equipe do projeto projeto-1 como DIRETOR.',
      },
      {
        destinatarioId: 'prof-2',
        tipoDestinatario: 'PROFISSIONAL',
        assunto: 'Equipe formada',
        corpo: 'Você faz parte da equipe do projeto projeto-1 como EDITOR.',
      },
    ]);
  });

  it('os motivos fora da lista não geram aviso', () => {
    const silenciosos = TIPOS_EVENTO_API.filter((motivo) => !MOTIVOS_NOTIFICAVEIS.includes(motivo));

    expect(silenciosos).toEqual([
      'SUBSTITUICAO_SOLICITADA',
      'MEMBRO_REJEITADO',
      'REAVALIACAO_SOLICITADA',
      'DETALHES_ATUALIZADOS',
      'ARQUIVO_ANEXADO',
      'PAGAMENTO_EFETUADO',
      'PAGAMENTO_CANCELADO',
    ]);
    for (const motivo of silenciosos) {
      expect(comporAvisos(criarEventoProjeto({ motivo }))).toEqual([]);
    }
  });
});

describe('comporAvisos para PROJETO_CRIADO', () => {
  it('avisa o produtor que o projeto foi registrado', () => {
    const avisos = comporAvisos(criarEventoProjeto({ tipo: 'PROJETO_CRIADO', status: 'CRIADO' }));

    expect(avisos).toEqual([
      {
        destinatarioId: 'produtor-1',
        tipoDestinatario: 'PRODUTOR',
        assunto: 'Projeto registrado: Curta na Serra',
        corpo:
          'O projeto Curta na Serra (projeto-1) foi registrado no CineBridge com status CRIADO.',
      },
    ]);
  });

  it('soma o aviso de registro aos avisos do motivo, na ordem', () => {
    const avisos = comporAvisos(
      criarEventoProjeto({
        tipo: 'PROJETO_CRIADO',
        status: 'CRIADO',
        motivo: 'RECOMENDACAO_GERADA',
        detalhe: DETALHES_POR_MOTIVO.RECOMENDACAO_GERADA,
      }),
    );

    expect(avisos.map((aviso) => [aviso.destinatarioId, aviso.assunto])).toEqual([
      ['produtor-1', 'Projeto registrado: Curta na Serra'],
      ['prof-1', 'Um produtor tem interesse no seu perfil'],
      ['prof-2', 'Um produtor tem interesse no seu perfil'],
    ]);
  });

  it('não repete o aviso de registro em PROJETO_ATUALIZADO nem em PROJETO_FINALIZADO', () => {
    for (const tipo of ['PROJETO_ATUALIZADO', 'PROJETO_FINALIZADO'] as const) {
      expect(comporAvisos(criarEventoProjeto({ tipo }))).toEqual([]);
    }
  });
});

describe('comporAvisos com detalhe incompleto (leitura defensiva)', () => {
  it('usa o produtor e o projeto do snapshot quando o detalhe não os traz', () => {
    const avisos = comporAvisos(
      criarEventoProjeto({ motivo: 'CONVITE_ACEITO', detalhe: { papel: 'DIRETOR' } }),
    );

    expect(avisos).toEqual([
      {
        destinatarioId: 'produtor-1',
        tipoDestinatario: 'PRODUTOR',
        assunto: 'Convite aceito para DIRETOR',
        corpo: 'O profissional não identificado aceitou o convite do projeto projeto-1.',
      },
    ]);
  });

  it('ignora destinatários ausentes e itens que não são objetos', () => {
    const avisos = comporAvisos(
      criarEventoProjeto({
        motivo: 'RECOMENDACAO_GERADA',
        detalhe: {
          profissionais: [null, 'texto', { papel: 'DIRETOR' }, { profissionalId: 'prof-9' }],
        },
      }),
    );

    expect(avisos).toEqual([
      {
        destinatarioId: 'prof-9',
        tipoDestinatario: 'PROFISSIONAL',
        assunto: 'Um produtor tem interesse no seu perfil',
        corpo: 'Você foi recomendado(a) como papel não informado para o projeto projeto-1.',
      },
    ]);
  });

  it('não falha quando as listas e os campos não existem ou têm tipo errado', () => {
    expect(
      comporAvisos(criarEventoProjeto({ motivo: 'RECOMENDACAO_GERADA', detalhe: {} })),
    ).toEqual([]);
    expect(
      comporAvisos(
        criarEventoProjeto({ motivo: 'RECOMENDACAO_GERADA', detalhe: { profissionais: 'x' } }),
      ),
    ).toEqual([]);
    expect(comporAvisos(criarEventoProjeto({ motivo: 'CONVITE_ENVIADO', detalhe: {} }))).toEqual(
      [],
    );
    expect(
      comporAvisos(
        criarEventoProjeto({ motivo: 'CONVITE_EXPIRADO', detalhe: { profissionalId: 7 } }),
      ),
    ).toHaveLength(2);
  });

  it('descreve o prazo e o motivo quando não vêm no detalhe', () => {
    const convite = comporAvisos(
      criarEventoProjeto({ motivo: 'CONVITE_ENVIADO', detalhe: { profissionalId: 'prof-1' } }),
    );
    const substituicao = comporAvisos(
      criarEventoProjeto({ motivo: 'SUBSTITUICAO_INDISPONIVEL', detalhe: {} }),
    );

    expect(convite[0]?.corpo).toContain('Responda até o prazo informado.');
    expect(substituicao[0]?.corpo).toContain('motivo não informado.');
  });
});

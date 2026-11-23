import type { TipoEventoApi } from '../contratos/atualizacoes-projetos.js';
import type { EventoProjeto } from '../contratos/eventos-projetos.js';
import type { Aviso, TipoDestinatario } from './aviso.js';

export const MOTIVOS_NOTIFICAVEIS: readonly TipoEventoApi[] = [
  'RECOMENDACAO_GERADA',
  'CONVITE_ENVIADO',
  'CONVITE_ACEITO',
  'CONVITE_RECUSADO',
  'CONVITE_EXPIRADO',
  'SUBSTITUICAO_INDISPONIVEL',
  'EQUIPE_FORMADA',
];

type Registro = Readonly<Record<string, unknown>>;

function ehRegistro(valor: unknown): valor is Registro {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function texto(registro: Registro, campo: string): string | undefined {
  const valor = registro[campo];
  if (typeof valor === 'string' && valor.length > 0) {
    return valor;
  }
  if (typeof valor === 'number') {
    return String(valor);
  }
  return undefined;
}

function registros(registro: Registro, campo: string): readonly Registro[] {
  const valor = registro[campo];
  return Array.isArray(valor) ? (valor as unknown[]).filter(ehRegistro) : [];
}

const PAPEL_NAO_INFORMADO = 'papel não informado';

export function comporAvisos(evento: EventoProjeto): Aviso[] {
  const { projeto, motivo, detalhe } = evento.dados;
  const projetoId = texto(detalhe, 'projetoId') ?? projeto.id;
  const produtorId = texto(detalhe, 'produtorId') ?? projeto.produtorId;
  const papel = texto(detalhe, 'papel') ?? PAPEL_NAO_INFORMADO;
  const profissionalId = texto(detalhe, 'profissionalId');

  const para = (
    destinatarioId: string | undefined,
    tipoDestinatario: TipoDestinatario,
    assunto: string,
    corpo: string,
  ): Aviso[] =>
    destinatarioId === undefined ? [] : [{ destinatarioId, tipoDestinatario, assunto, corpo }];

  const avisos: Aviso[] = [];

  if (evento.tipo === 'PROJETO_CRIADO') {
    avisos.push(
      ...para(
        projeto.produtorId,
        'PRODUTOR',
        `Projeto registrado: ${projeto.titulo}`,
        `O projeto ${projeto.titulo} (${projeto.id}) foi registrado no CineBridge com status ${projeto.status}.`,
      ),
    );
  }

  switch (motivo) {
    case 'RECOMENDACAO_GERADA':
      for (const recomendado of registros(detalhe, 'profissionais')) {
        avisos.push(
          ...para(
            texto(recomendado, 'profissionalId'),
            'PROFISSIONAL',
            'Um produtor tem interesse no seu perfil',
            `Você foi recomendado(a) como ${texto(recomendado, 'papel') ?? PAPEL_NAO_INFORMADO} para o projeto ${projetoId}.`,
          ),
        );
      }
      break;
    case 'CONVITE_ENVIADO':
      avisos.push(
        ...para(
          profissionalId,
          'PROFISSIONAL',
          `Convite para atuar como ${papel}`,
          `Você foi convidado(a) para o projeto ${projetoId}. Responda até ${texto(detalhe, 'expiraEm') ?? 'o prazo informado'}.`,
        ),
      );
      break;
    case 'CONVITE_ACEITO':
      avisos.push(
        ...para(
          produtorId,
          'PRODUTOR',
          `Convite aceito para ${papel}`,
          `O profissional ${profissionalId ?? 'não identificado'} aceitou o convite do projeto ${projetoId}.`,
        ),
      );
      break;
    case 'CONVITE_RECUSADO':
      avisos.push(
        ...para(
          produtorId,
          'PRODUTOR',
          `Convite recusado para ${papel}`,
          `O profissional ${profissionalId ?? 'não identificado'} recusou o convite. O sistema vai buscar um substituto para ${papel}.`,
        ),
      );
      break;
    case 'CONVITE_EXPIRADO':
      avisos.push(
        ...para(
          produtorId,
          'PRODUTOR',
          `Convite expirado para ${papel}`,
          `O profissional ${profissionalId ?? 'não identificado'} não respondeu ao convite do projeto ${projetoId} no prazo. O sistema vai buscar um substituto para ${papel}.`,
        ),
        ...para(
          profissionalId,
          'PROFISSIONAL',
          `Convite expirado para ${papel}`,
          `O prazo para responder ao convite do projeto ${projetoId} terminou.`,
        ),
      );
      break;
    case 'SUBSTITUICAO_INDISPONIVEL':
      avisos.push(
        ...para(
          produtorId,
          'PRODUTOR',
          `Sem substituto automático para ${papel}`,
          `Não foi possível iniciar a nova rodada para ${papel} no projeto ${projetoId}: ${texto(detalhe, 'motivo') ?? 'motivo não informado.'} Escolha um substituto ou ajuste o projeto.`,
        ),
      );
      break;
    case 'EQUIPE_FORMADA': {
      const membros = registros(detalhe, 'membros');
      avisos.push(
        ...para(
          produtorId,
          'PRODUTOR',
          'Equipe formada',
          `A equipe do projeto ${projetoId} foi formada com ${membros.length} membros.`,
        ),
      );
      for (const membro of membros) {
        avisos.push(
          ...para(
            texto(membro, 'profissionalId'),
            'PROFISSIONAL',
            'Equipe formada',
            `Você faz parte da equipe do projeto ${projetoId} como ${texto(membro, 'papel') ?? PAPEL_NAO_INFORMADO}.`,
          ),
        );
      }
      break;
    }
    case 'SUBSTITUICAO_SOLICITADA':
    case 'MEMBRO_REJEITADO':
    case 'REAVALIACAO_SOLICITADA':
    case 'DETALHES_ATUALIZADOS':
    case 'ARQUIVO_ANEXADO':
    case 'PAGAMENTO_EFETUADO':
    case 'PAGAMENTO_CANCELADO':
      break;
  }

  return avisos;
}

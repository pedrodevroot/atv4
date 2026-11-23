import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

const CODIGOS_INDISPONIBILIDADE = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  '57P01',
  '57P03',
]);

export function ehIndisponibilidadeBanco(erro: Error): boolean {
  const codigo = (erro as { code?: unknown }).code;
  return (
    (typeof codigo === 'string' && CODIGOS_INDISPONIBILIDADE.has(codigo)) ||
    /not connected|connection terminated|timeout exceeded when trying to connect|getaddrinfo/i.test(
      erro.message,
    )
  );
}

export function tratarErro(
  erro: FastifyError | Error,
  requisicao: FastifyRequest,
  resposta: FastifyReply,
) {
  if ('validation' in erro && erro.validation) {
    return resposta.status(400).send({
      codigo: 'REQUISICAO_INVALIDA',
      mensagem: 'A requisição não atende ao contrato esperado.',
      detalhes: erro.validation.map(
        (falha) =>
          `${falha.instancePath || erro.validationContext || 'requisicao'}: ${falha.message ?? ''}`,
      ),
    });
  }

  if (ehIndisponibilidadeBanco(erro)) {
    requisicao.log.warn({ err: erro }, 'PostgreSQL indisponível ao atender a consulta');
    return resposta.status(503).send({
      codigo: 'BANCO_INDISPONIVEL',
      mensagem: 'O banco do cinebridge-projetos está indisponível; tente de novo em instantes.',
    });
  }

  requisicao.log.error({ err: erro }, 'Erro inesperado ao atender a requisição');
  return resposta.status(500).send({
    codigo: 'ERRO_INTERNO',
    mensagem: 'Erro inesperado no cinebridge-projetos.',
  });
}

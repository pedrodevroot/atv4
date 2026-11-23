export const INTERVALO_AQUECIMENTO_MS = 5_000;

export interface OpcoesAquecimento {
  readonly intervaloMs?: number;
  readonly aoFalhar?: (tentativa: number, novaTentativaEmMs: number) => void;
  readonly aoConcluir?: (tentativas: number) => void;
}

export interface Aquecimento {
  readonly concluido: boolean;
  readonly tentativas: number;
  parar(): void;
}

export function aquecerComNovasTentativas(
  aquecer: () => Promise<boolean>,
  opcoes: OpcoesAquecimento = {},
): Aquecimento {
  const intervaloMs = opcoes.intervaloMs ?? INTERVALO_AQUECIMENTO_MS;
  let parado = false;
  let concluido = false;
  let tentativas = 0;
  let temporizador: NodeJS.Timeout | undefined;

  const interrompido = (): boolean => parado;

  const tentar = async (): Promise<void> => {
    temporizador = undefined;
    if (interrompido()) {
      return;
    }
    tentativas += 1;
    const aquecido = await aquecer().catch(() => false);
    if (aquecido) {
      concluido = true;
      opcoes.aoConcluir?.(tentativas);
      return;
    }
    if (interrompido()) {
      return;
    }
    opcoes.aoFalhar?.(tentativas, intervaloMs);
    temporizador = setTimeout(() => void tentar(), intervaloMs);
    temporizador.unref();
  };

  void tentar();

  return {
    get concluido() {
      return concluido;
    },
    get tentativas() {
      return tentativas;
    },
    parar() {
      parado = true;
      clearTimeout(temporizador);
      temporizador = undefined;
    },
  };
}

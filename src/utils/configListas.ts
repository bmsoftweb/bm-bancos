import { buscarConfigListas, gravarConfigListas } from '../services/api';

/**
 * Preferências de cada grade, gravadas em sys_usuarios.config_listas como JSON.
 * Mesmo formato do usuarios.config_listas do b2b admin.
 */

export type LinhasGrade = 'ambas' | 'horizontais' | 'verticais' | 'nenhuma';

/** Como as larguras são definidas: recalculadas na abertura ou fixadas pelo usuário */
export type ModoLargura = 'manual' | 'ajustar' | 'melhor';

export interface ConfigLista {
  /** Só gravado no modo manual: nos automáticos a largura é recalculada ao abrir */
  larguras?: Record<string, number>;
  ordem?: string[];
  grade?: LinhasGrade;
  /** false depois de 'Ajustar largura': as colunas ocupam tudo, sem a coluna vazia do fim */
  sobra?: boolean;
  modo?: ModoLargura;
}

let cache: Record<string, ConfigLista> | null = null;
let carregando: Promise<Record<string, ConfigLista>> | null = null;

/** Lê uma vez do servidor e depois serve da memória */
export async function lerConfigLista(recurso: string): Promise<ConfigLista> {
  if (!cache) {
    carregando =
      carregando ||
      buscarConfigListas()
        .then((c) => (cache = (c as Record<string, ConfigLista>) || {}))
        .catch(() => (cache = {}));
    await carregando;
  }
  return cache?.[recurso] || {};
}

/**
 * Grava a preferência da grade (e mantém as das outras listas). Diferente do b2b,
 * que grava em segundo plano e engole o erro, aqui a gravação é esperada: é o
 * clique em "Salvar Configuração" e o usuário precisa saber se deu certo.
 */
export async function salvarConfigLista(recurso: string, config: ConfigLista): Promise<void> {
  const novo = { ...(cache || {}), [recurso]: config };
  await gravarConfigListas(novo);
  cache = novo;
}

export function limparConfigListas() {
  cache = null;
  carregando = null;
}

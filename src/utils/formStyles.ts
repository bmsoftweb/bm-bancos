/**
 * Padrão visual dos campos de entrada, alinhado ao meuConsultorioWeb.
 *
 * A moldura, o raio e o comportamento de foco NÃO ficam aqui: vêm de uma regra
 * global em index.css que se aplica a todo input/select/textarea — campo sem borda,
 * apenas uma barra de 2px à esquerda (âmbar quando obrigatório, verde quando
 * opcional). Estas classes cuidam só de fundo, espaçamento e tipografia.
 */

/** Campo padrão de formulário e de filtros. A largura fica a cargo de quem usa. */
export const INPUT_CLASS =
  'bg-stone-50 dark:bg-stone-800/80 p-2 px-3 text-xs font-medium text-stone-800 dark:text-stone-100 placeholder:text-stone-400 placeholder:font-normal transition-all';

/** Campo maior, usado na tela de login */
export const INPUT_CLASS_LG =
  'bg-stone-50 dark:bg-stone-800/80 p-3 text-sm font-medium text-stone-800 dark:text-stone-100 placeholder:text-stone-400 placeholder:font-normal transition-all';

/** Rótulo acima do campo */
export const LABEL_CLASS = 'text-xs font-semibold text-stone-500 dark:text-stone-400';

/** Contêiner de um par rótulo + campo */
export const FIELD_CLASS = 'flex flex-col gap-1';

/** Texto auxiliar exibido abaixo do campo */
export const HINT_CLASS = 'text-[11px] font-medium text-stone-400 dark:text-stone-500';

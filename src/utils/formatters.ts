/** Formatações de exibição. Datas em dd/mm/aaaa, números alinhados à direita nas listas. */

export function formatarCnpj(valor: string): string {
  const c = (valor || '').replace(/\D/g, '');
  if (c.length !== 14) return valor || '';
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}

export function formatarCpfCnpj(valor: string): string {
  const c = (valor || '').replace(/\D/g, '');
  if (c.length === 11) return `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}`;
  return formatarCnpj(c);
}

/** "2026-09-20 14:32:05" -> "20/09/2026 14:32" */
export function formatarDataHora(valor: string | null | undefined): string {
  if (!valor) return '—';
  const m = String(valor).match(/^(\d{4})-(\d{2})-(\d{2})[T ]?(\d{2})?:?(\d{2})?/);
  if (!m) return String(valor);
  const data = `${m[3]}/${m[2]}/${m[1]}`;
  return m[4] ? `${data} ${m[4]}:${m[5]}` : data;
}

export function formatarData(valor: string | null | undefined): string {
  return formatarDataHora(valor).slice(0, 10);
}

export function formatarMoeda(valor: number | string | null | undefined): string {
  const n = Number(valor ?? 0);
  return (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Moeda ou travessão quando não há valor */
export const moedaOuTraco = (v: number | string | null | undefined) => (v === null || v === undefined || v === '' ? '—' : formatarMoeda(v));

type Etiquetas = Record<string, { rotulo: string; classe: string }>;

const COR = {
  azul: 'bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300',
  ambar: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
  verde: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
  vermelho: 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300',
  cinza: 'bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300',
  roxo: 'bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300',
};

export const SITUACOES_BOLETO: Etiquetas = {
  emitido: { rotulo: 'Emitido', classe: COR.azul },
  processando: { rotulo: 'Processando', classe: COR.ambar },
  enviado: { rotulo: 'Enviado', classe: COR.ambar },
  registrado: { rotulo: 'Registrado', classe: COR.roxo },
  rejeitado: { rotulo: 'Rejeitado', classe: COR.vermelho },
  liquidado: { rotulo: 'Liquidado', classe: COR.verde },
  baixado: { rotulo: 'Baixado', classe: COR.cinza },
  cancelado: { rotulo: 'Cancelado', classe: COR.cinza },
};

export const TIPOS_OCORRENCIA: Etiquetas = {
  entrada: { rotulo: 'Entrada', classe: COR.roxo },
  rejeicao: { rotulo: 'Rejeição', classe: COR.vermelho },
  liquidacao: { rotulo: 'Liquidação', classe: COR.verde },
  baixa: { rotulo: 'Baixa', classe: COR.cinza },
  alteracao: { rotulo: 'Alteração', classe: COR.azul },
  protesto: { rotulo: 'Protesto', classe: COR.ambar },
  tarifa: { rotulo: 'Tarifa', classe: COR.cinza },
  outra: { rotulo: 'Outra', classe: COR.cinza },
};

export const SITUACOES_REMESSA: Etiquetas = {
  gerada: { rotulo: 'Gerada', classe: COR.azul },
  enviada: { rotulo: 'Enviada', classe: COR.verde },
  cancelada: { rotulo: 'Cancelada', classe: COR.cinza },
};

export const SITUACOES_LANCAMENTO: Etiquetas = {
  pendente: { rotulo: 'Pendente', classe: COR.ambar },
  conciliado: { rotulo: 'Conciliado', classe: COR.verde },
  ignorado: { rotulo: 'Ignorado', classe: COR.cinza },
};

export const SITUACOES_INSTRUCAO: Etiquetas = {
  pendente: { rotulo: 'Pendente', classe: COR.ambar },
  enviada: { rotulo: 'Enviada', classe: COR.azul },
  confirmada: { rotulo: 'Confirmada', classe: COR.verde },
  rejeitada: { rotulo: 'Rejeitada', classe: COR.vermelho },
};

export const INSTRUCOES: Record<string, string> = {
  baixar: 'Baixar (cancelar no banco)',
  alterar_vencimento: 'Alterar vencimento',
  alterar_valor: 'Alterar valor',
  conceder_abatimento: 'Conceder abatimento',
  cancelar_abatimento: 'Cancelar abatimento',
  protestar: 'Protestar',
  sustar_protesto: 'Sustar protesto',
};

export const AMBIENTES: Record<number, string> = { 1: 'Produção', 2: 'Homologação' };
export const CANAIS: Record<string, string> = { remessa: 'Remessa CNAB', api: 'API do banco' };

/** Opções de select a partir de um mapa de etiquetas, com "Todas" no começo */
export const opcoesFiltro = (mapa: Etiquetas, todas = 'Todas') => [
  { valor: '', rotulo: todas },
  ...Object.entries(mapa).map(([valor, e]) => ({ valor, rotulo: e.rotulo })),
];

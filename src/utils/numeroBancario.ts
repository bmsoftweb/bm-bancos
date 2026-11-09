/**
 * Conversões do campo numérico no padrão dos aplicativos bancários: o valor é
 * guardado como uma sequência de dígitos (sem vírgula), preenchida da direita
 * para a esquerda. Para 1.467,45 com 2 casas, a sequência é "146745".
 */

/** Limite de dígitos: cabe com folga em decimal(14,2) e em int */
export const MAX_DIGITOS = 15;

export interface EstadoNumero {
  negativo: boolean;
  digitos: string;
}

/** Valor canônico ("1467.45", "-12", 430, "") -> estado em dígitos */
export function paraDigitos(valor: string | number | null | undefined, scale: number): EstadoNumero {
  if (valor === null || valor === undefined) return { negativo: false, digitos: '' };
  const texto = String(valor).trim();
  if (texto === '') return { negativo: false, digitos: '' };

  const negativo = texto.startsWith('-');
  const [inteiro = '', fracao = ''] = texto.replace(/^[-+]/, '').split('.');
  const fracaoAjustada = scale > 0 ? (fracao + '0'.repeat(scale)).slice(0, scale) : '';
  const digitos = `${inteiro.replace(/\D/g, '')}${fracaoAjustada}`.replace(/^0+/, '');
  return { negativo: negativo && digitos !== '', digitos };
}

/** Estado em dígitos -> valor canônico aceito pelo backend ("1467.45") */
export function paraCanonico({ negativo, digitos }: EstadoNumero, scale: number): string {
  if (digitos === '') return '';
  const cheio = digitos.padStart(scale + 1, '0');
  const inteiro = cheio.slice(0, cheio.length - scale) || '0';
  const sinal = negativo ? '-' : '';
  return scale > 0 ? `${sinal}${inteiro}.${cheio.slice(-scale)}` : `${sinal}${inteiro}`;
}

/** Estado em dígitos -> texto exibido no campo ("1.467,45") */
export function paraExibicao({ negativo, digitos }: EstadoNumero, scale: number): string {
  if (digitos === '') return '';
  const cheio = digitos.padStart(scale + 1, '0');
  const inteiro = (cheio.slice(0, cheio.length - scale) || '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fracao = scale > 0 ? `,${cheio.slice(-scale)}` : '';
  return `${negativo ? '-' : ''}${inteiro}${fracao}`;
}

/**
 * Interpreta o novo conteúdo do campo depois de uma digitação.
 * @param bruto   o que o navegador colocou no campo (texto exibido + a tecla)
 * @param atual   estado antes da digitação
 */
export function aplicarDigitacao(
  bruto: string,
  atual: EstadoNumero,
  scale: number,
  allowNegative: boolean,
): EstadoNumero {
  const exibicaoAtual = paraExibicao(atual, scale);
  let digitos = bruto.replace(/\D/g, '').replace(/^0+/, '');

  // Backspace sobre um separador ("." ou ",") não apaga dígito: remove o último
  if (digitos === atual.digitos && bruto.length < exibicaoAtual.length) {
    digitos = atual.digitos.slice(0, -1);
  }
  digitos = digitos.slice(0, MAX_DIGITOS);

  // Cada "-" alterna o sinal; "+" força positivo
  let negativo = false;
  if (allowNegative) {
    const qtdMenos = (bruto.match(/-/g) || []).length;
    negativo = bruto.includes('+') ? false : qtdMenos % 2 === 1;
  }
  return { negativo: negativo && digitos !== '', digitos };
}

/** Texto colado ("1.467,45", "1467.45", "R$ 1.467,45") -> estado em dígitos */
export function aplicarColagem(texto: string, scale: number, allowNegative: boolean): EstadoNumero | null {
  const limpo = texto.trim();
  // Vírgula seguida só de dígitos no fim = vírgula decimal brasileira
  const normalizado = /,\d+$/.test(limpo) ? limpo.replace(/\./g, '').replace(',', '.') : limpo.replace(/,/g, '');
  const numero = Number(normalizado.replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(numero) || normalizado.replace(/[^\d]/g, '') === '') return null;
  const estado = paraDigitos((allowNegative ? numero : Math.abs(numero)).toFixed(scale), scale);
  return { ...estado, digitos: estado.digitos.slice(0, MAX_DIGITOS) };
}

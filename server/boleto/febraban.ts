/**
 * Código de barras e linha digitável do boleto (padrão FEBRABAN), iguais para
 * todos os bancos. O que muda de banco para banco é só o campo livre (25
 * posições), que vem do módulo do banco.
 *
 *   posição  0-2  banco
 *            3    moeda (9 = real)
 *            4    DV geral (módulo 11)
 *            5-8  fator de vencimento
 *            9-18 valor em centavos
 *            19-43 campo livre
 */

/** Só os dígitos */
export const digitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');

/**
 * Módulo 10 (pesos 2,1,2,1... da direita para a esquerda, somando os dígitos
 * dos produtos). Usado nos três primeiros campos da linha digitável e no nosso
 * número de alguns bancos.
 */
export function modulo10(numero: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = numero.length - 1; i >= 0; i--) {
    let p = Number(numero[i]) * peso;
    if (p > 9) p = Math.floor(p / 10) + (p % 10);
    soma += p;
    peso = peso === 2 ? 1 : 2;
  }
  return (10 - (soma % 10)) % 10;
}

/**
 * Soma ponderada do módulo 11 (pesos 2..pesoMaximo da direita para a esquerda,
 * reiniciando). Devolve o resto da divisão por 11: cada banco aplica a própria
 * regra em cima dele.
 */
export function restoModulo11(numero: string, pesoMaximo = 9): number {
  let soma = 0;
  let peso = 2;
  for (let i = numero.length - 1; i >= 0; i--) {
    soma += Number(numero[i]) * peso;
    peso = peso === pesoMaximo ? 2 : peso + 1;
  }
  return soma % 11;
}

/** DV geral do código de barras: 11 - resto; 0, 10 e 11 viram 1 */
export function dvCodigoBarras(semDv43: string): number {
  const dv = 11 - restoModulo11(semDv43);
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
}

const DIA_MS = 86_400_000;
const BASE_FATOR = Date.UTC(1997, 9, 7); // 07/10/1997

/**
 * Fator de vencimento: dias desde 07/10/1997. Chegou a 9999 em 21/02/2025 e
 * recomeçou em 1000 no dia 22/02/2025 (FEBRABAN); depois disso recomeça a
 * cada 9000 dias.
 */
export function fatorVencimento(dataIso: string): string {
  const m = String(dataIso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`Vencimento inválido: "${dataIso}".`);
  const dias = Math.round((Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - BASE_FATOR) / DIA_MS);
  if (dias < 1000) throw new Error(`Vencimento ${dataIso} anterior ao fator de vencimento 1000.`);
  const fator = dias <= 9999 ? dias : ((dias - 10000) % 9000) + 1000;
  return String(fator).padStart(4, '0');
}

/** Valor em centavos com 10 posições */
export function valorCodigoBarras(valor: number): string {
  const centavos = Math.round(Number(valor) * 100);
  if (!Number.isFinite(centavos) || centavos < 0) throw new Error(`Valor inválido: ${valor}.`);
  if (centavos > 9_999_999_999) throw new Error('Valor acima do limite do boleto (R$ 99.999.999,99).');
  return String(centavos).padStart(10, '0');
}

/** Código de barras completo (44 dígitos) */
export function codigoBarras(banco: string, vencimento: string, valor: number, campoLivre: string): string {
  if (!/^\d{3}$/.test(banco)) throw new Error(`Código do banco inválido: "${banco}".`);
  if (!/^\d{25}$/.test(campoLivre)) throw new Error(`Campo livre deve ter 25 dígitos (veio "${campoLivre}").`);
  const semDv = `${banco}9${fatorVencimento(vencimento)}${valorCodigoBarras(valor)}${campoLivre}`;
  return `${semDv.slice(0, 4)}${dvCodigoBarras(semDv)}${semDv.slice(4)}`;
}

/** Linha digitável (47 dígitos) a partir do código de barras */
export function linhaDigitavel(barras: string): string {
  if (!/^\d{44}$/.test(barras)) throw new Error('Código de barras deve ter 44 dígitos.');
  const campo = (s: string) => `${s}${modulo10(s)}`;
  return (
    campo(barras.slice(0, 4) + barras.slice(19, 24)) +
    campo(barras.slice(24, 34)) +
    campo(barras.slice(34, 44)) +
    barras[4] +
    barras.slice(5, 19)
  );
}

/** Código de barras (44) a partir da linha digitável (47) */
export function barrasDaLinha(linha: string): string {
  const l = digitos(linha);
  if (l.length !== 47) throw new Error('Linha digitável deve ter 47 dígitos.');
  return l.slice(0, 4) + l[32] + l.slice(33, 47) + l.slice(4, 9) + l.slice(10, 20) + l.slice(21, 31);
}

/** "00190.00009 01234.567890 12345.678901 2 12340000010000" */
export function formatarLinha(linha: string): string {
  const l = digitos(linha);
  if (l.length !== 47) return linha;
  return `${l.slice(0, 5)}.${l.slice(5, 10)} ${l.slice(10, 15)}.${l.slice(15, 21)} ${l.slice(21, 26)}.${l.slice(26, 32)} ${l[32]} ${l.slice(33)}`;
}

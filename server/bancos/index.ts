/** Bancos implementados. Banco novo = um arquivo nesta pasta + uma linha aqui. */
import { ModuloBanco } from '../boleto/tipos.js';
import { bb } from './bb.js';
import { sicoob } from './sicoob.js';

export const BANCOS: Record<string, ModuloBanco> = {
  '001': bb,
  '756': sicoob,
};

export function moduloDoBanco(codigo: string): ModuloBanco {
  const m = BANCOS[codigo];
  if (!m) throw new Error(`O banco ${codigo} ainda não está implementado no BMBancos (disponíveis: ${Object.keys(BANCOS).join(', ')}).`);
  return m;
}

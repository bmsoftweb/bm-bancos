/**
 * Campos de largura fixa dos arquivos CNAB 240/400.
 *
 * Campo maior que o espaço é erro, não corte: um número de conta ou um valor
 * truncado em silêncio vira boleto na conta errada. Texto (nome, endereço) é a
 * exceção: esse sim é cortado, como todo banco espera.
 */

const SEM_ACENTO: Record<string, string> = {
  Á: 'A', À: 'A', Â: 'A', Ã: 'A', Ä: 'A', É: 'E', È: 'E', Ê: 'E', Ë: 'E', Í: 'I', Ì: 'I', Î: 'I', Ï: 'I',
  Ó: 'O', Ò: 'O', Ô: 'O', Õ: 'O', Ö: 'O', Ú: 'U', Ù: 'U', Û: 'U', Ü: 'U', Ç: 'C', Ñ: 'N', º: 'O', ª: 'A',
};

/** Texto em maiúsculas, sem acento e só com caracteres aceitos pelos bancos */
export function limparTexto(valor: unknown): string {
  return String(valor ?? '')
    .toUpperCase()
    .replace(/[ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑºª]/g, (c) => SEM_ACENTO[c] || c)
    .replace(/[^A-Z0-9 .,\-/&()@:;*_+]/g, ' ');
}

/** Alfanumérico: alinhado à esquerda, completado com espaços, cortado no tamanho */
export function alfa(valor: unknown, tamanho: number): string {
  return limparTexto(valor).slice(0, tamanho).padEnd(tamanho, ' ');
}

/** Numérico: alinhado à direita com zeros. Maior que o campo = erro. */
export function num(valor: unknown, tamanho: number, nome = 'campo'): string {
  const d = String(valor ?? '').replace(/\D/g, '');
  if (d.length > tamanho) throw new Error(`${nome} "${d}" não cabe em ${tamanho} posições.`);
  return d.padStart(tamanho, '0');
}

/** Valor em reais -> centavos com zeros à esquerda */
export function valor(reais: number | undefined | null, tamanho: number, nome = 'valor'): string {
  const centavos = Math.round(Number(reais ?? 0) * 100);
  if (!Number.isFinite(centavos) || centavos < 0) throw new Error(`${nome} inválido: ${reais}.`);
  return num(String(centavos), tamanho, nome);
}

/** Percentual com N casas decimais (ex.: 2,5% com 5 posições e 2 casas -> "00250") */
export function percentual(p: number | undefined | null, tamanho: number, casas = 2): string {
  return num(String(Math.round(Number(p ?? 0) * 10 ** casas)), tamanho, 'percentual');
}

/** "AAAA-MM-DD" -> "DDMMAAAA" (ou "DDMMAA"); vazio vira zeros */
export function data(iso: string | undefined | null, formato: 'DDMMAAAA' | 'DDMMAA' = 'DDMMAAAA'): string {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '0'.repeat(formato.length);
  return formato === 'DDMMAAAA' ? `${m[3]}${m[2]}${m[1]}` : `${m[3]}${m[2]}${m[1].slice(2)}`;
}

/** Date local -> "HHMMSS" */
export function hora(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Date local -> "AAAA-MM-DD" */
export function dataIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Brancos */
export const brancos = (tamanho: number) => ' '.repeat(tamanho);

/** Junta os pedaços de um registro e confere o tamanho (240 ou 400) */
export function registro(tamanho: 240 | 400, ...partes: string[]): string {
  const linha = partes.join('');
  if (linha.length !== tamanho) {
    throw new Error(`Registro com ${linha.length} posições, esperado ${tamanho}: ${linha.slice(0, 20)}...`);
  }
  return linha;
}

/** Arquivo: linhas com CRLF, terminado em CRLF */
export const arquivo = (linhas: string[]) => `${linhas.join('\r\n')}\r\n`;

// ---------------------------------------------------------------------------
// Leitura (retorno). Posições como nos manuais: começam em 1 e incluem o fim.
// ---------------------------------------------------------------------------

/** Trecho da linha pelas posições do manual (de, ate inclusive, base 1) */
export const pos = (linha: string, de: number, ate: number) => linha.slice(de - 1, ate);

/** Valor em centavos -> reais */
export const lerValor = (linha: string, de: number, ate: number) => Number(pos(linha, de, ate).replace(/\D/g, '') || 0) / 100;

/** "DDMMAAAA" ou "DDMMAA" -> "AAAA-MM-DD"; zeros ou brancos -> "" */
export function lerData(linha: string, de: number, ate: number): string {
  const t = pos(linha, de, ate).trim();
  if (!/^\d+$/.test(t) || /^0+$/.test(t)) return '';
  if (t.length === 8) return `${t.slice(4, 8)}-${t.slice(2, 4)}-${t.slice(0, 2)}`;
  if (t.length === 6) return `20${t.slice(4, 6)}-${t.slice(2, 4)}-${t.slice(0, 2)}`;
  return '';
}

/** Linhas do arquivo, sem as vazias, aceitando CRLF, LF ou CR */
export const linhas = (conteudo: string) => conteudo.split(/\r\n|\n|\r/).filter((l) => l.trim().length > 0);

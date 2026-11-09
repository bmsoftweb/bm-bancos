/**
 * Cifra dos segredos de ban_credenciais (client_secret, chave do aplicativo,
 * senha do certificado) com AES-256-GCM.
 *
 * A chave vem de CHAVE_CREDENCIAIS, e não do SESSION_SECRET: o banco é o mesmo
 * na execução local e na Vercel, e cada ambiente tem o seu SESSION_SECRET.
 * CHAVE_CREDENCIAIS tem de ser igual em todos; perdê-la obriga a digitar as
 * credenciais de novo (o resto dos dados não depende dela).
 */
import crypto from 'crypto';

const PREFIXO = 'v1:';

function chave(): Buffer {
  const bruto = process.env.CHAVE_CREDENCIAIS || '';
  const k = Buffer.from(bruto, 'base64');
  if (k.length !== 32) {
    throw new Error(
      'CHAVE_CREDENCIAIS não configurada (32 bytes em base64) no .env ou na Vercel. Gere com: ' +
        `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  return k;
}

export function cifrar(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', chave(), iv);
  const corpo = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return PREFIXO + Buffer.concat([iv, c.getAuthTag(), corpo]).toString('base64');
}

export function decifrar(cifrado: string | null | undefined): string {
  if (!cifrado) return '';
  if (!cifrado.startsWith(PREFIXO)) throw new Error('Credencial gravada fora do formato esperado: digite de novo.');
  const b = Buffer.from(cifrado.slice(PREFIXO.length), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', chave(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  try {
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  } catch {
    throw new Error('Não foi possível decifrar a credencial: CHAVE_CREDENCIAIS mudou? Digite as credenciais de novo.');
  }
}

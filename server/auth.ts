/**
 * Autenticação do BMBancos. Dois jeitos de entrar, no mesmo header
 * `Authorization: Bearer ...`:
 *
 * - Tela: o login (usuário do ERP em sys_usuarios) devolve um token assinado
 *   com HMAC-SHA256 (SESSION_SECRET), como no BMNFe. A empresa sai do token,
 *   e o usuário é relido do banco a cada requisição (cache de 30 s).
 * - Módulos do ERP: chave de API ("bmb_..."), sem prazo e revogável
 *   (ban_chaves_api). O banco guarda só o SHA-256 dela.
 *
 * A chave de API não abre o que é de administração (chaves, credenciais dos
 * bancos): essas rotas usam exigirUsuario.
 */
import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { pool } from './db.js';
import { dataHoraMysql } from './boleto/datas.js';

export interface UsuarioSessao {
  /** 0 quando a chamada vem de um módulo pela chave de API */
  id: number;
  empresaId: number;
  nome: string;
  email: string;
  /** Chamada de módulo: id da chave em ban_chaves_api */
  chaveId?: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      usuario?: UsuarioSessao;
    }
  }
}

const VALIDADE_MS = 1000 * 60 * 60 * 12; // 12 horas
const CACHE_MS = 30_000;
export const PREFIXO_CHAVE = 'bmb_';

function segredo(): string {
  const valor = process.env.SESSION_SECRET || '';
  // Segredo curto permitiria forjar token por força bruta
  if (valor.length < 32) {
    throw new Error('SESSION_SECRET não configurado (mínimo de 32 caracteres) no .env ou na Vercel.');
  }
  return valor;
}

function assinarTexto(conteudo: string): string {
  return crypto.createHmac('sha256', segredo()).update(conteudo).digest('base64url');
}

/** O token leva o usuário, a empresa e a validade, assinados */
export function criarToken(usuarioId: number, empresaId: number, agoraMs = Date.now()): string {
  const corpo = Buffer.from(
    JSON.stringify({ uid: usuarioId, emp: empresaId, exp: agoraMs + VALIDADE_MS }),
  ).toString('base64url');
  return `${corpo}.${assinarTexto(corpo)}`;
}

/** Devolve o conteúdo do token, ou null se for inválido, adulterado ou vencido */
export function lerToken(token: string, agoraMs = Date.now()): { uid: number; emp: number } | null {
  const [corpo, assinatura] = String(token || '').split('.');
  if (!corpo || !assinatura) return null;

  // Comparação em tempo constante: não deixa medir quantos bytes da assinatura bateram
  const recebida = Buffer.from(assinatura);
  const esperada = Buffer.from(assinarTexto(corpo));
  if (recebida.length !== esperada.length || !crypto.timingSafeEqual(recebida, esperada)) return null;

  try {
    const dados = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8'));
    if (!dados?.uid || !dados?.emp || Number(dados.exp) < agoraMs) return null;
    return { uid: Number(dados.uid), emp: Number(dados.emp) };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Usuário da sessão e chave de API
// ---------------------------------------------------------------------------

const cache = new Map<string, { usuario: UsuarioSessao | null; ate: number }>();

async function comCache(chave: string, carregar: () => Promise<UsuarioSessao | null>) {
  const emCache = cache.get(chave);
  if (emCache && emCache.ate > Date.now()) return emCache.usuario;
  const usuario = await carregar();
  cache.set(chave, { usuario, ate: Date.now() + CACHE_MS });
  return usuario;
}

const carregarUsuario = (id: number) =>
  comCache(`u${id}`, async () => {
    const [linhas] = await pool.query<any[]>(
      `SELECT u.id, u.empresa_id, u.login
         FROM sys_usuarios u JOIN sys_empresas e ON e.id = u.empresa_id
        WHERE u.id = ? AND u.ativo = 1 AND e.ativo = 1 LIMIT 1`,
      [id],
    );
    const l = linhas[0];
    return l ? { id: Number(l.id), empresaId: Number(l.empresa_id), nome: String(l.login), email: String(l.login) } : null;
  });

export const hashChave = (chave: string) => crypto.createHash('sha256').update(chave).digest('hex');

const carregarChave = (chave: string) => {
  const hash = hashChave(chave);
  return comCache(`k${hash}`, async () => {
    const [linhas] = await pool.query<any[]>(
      `SELECT k.id, k.empresa_id, k.nome FROM ban_chaves_api k JOIN sys_empresas e ON e.id = k.empresa_id
        WHERE k.chave_hash = ? AND k.ativo = 1 AND e.ativo = 1 LIMIT 1`,
      [hash],
    );
    const l = linhas[0];
    if (!l) return null;
    // Último uso: no máximo uma gravação por chave a cada 30 s (o cache)
    pool.query('UPDATE ban_chaves_api SET ultimo_uso = ? WHERE id = ?', [dataHoraMysql(), l.id]).catch(() => {});
    return { id: 0, empresaId: Number(l.empresa_id), nome: `API: ${l.nome}`, email: '', chaveId: Number(l.id) };
  });
};

/** Revogar uma chave vale na hora, sem esperar o cache */
export const esquecerChaves = () => {
  for (const k of cache.keys()) if (k.startsWith('k')) cache.delete(k);
};

/** Exige sessão de usuário ou chave de API válida e preenche req.usuario. Tudo em /api passa por aqui, menos o login. */
export async function exigirSessao(req: Request, res: Response, next: NextFunction) {
  try {
    const bruto = req.header('authorization') || '';
    const credencial = bruto.startsWith('Bearer ') ? bruto.slice(7).trim() : '';

    if (credencial.startsWith(PREFIXO_CHAVE)) {
      const modulo = await carregarChave(credencial);
      if (!modulo) return res.status(401).json({ success: false, error: 'Chave de API inválida ou revogada.' });
      req.usuario = modulo;
      return next();
    }

    const dados = lerToken(credencial);
    if (!dados) {
      return res.status(401).json({ success: false, error: 'Sessão expirada ou inválida. Entre novamente.' });
    }

    const usuario = await carregarUsuario(dados.uid);
    // O usuário mudou de empresa ou foi desativado (ele ou a empresa)
    if (!usuario || usuario.empresaId !== dados.emp) {
      return res.status(401).json({ success: false, error: 'Acesso não está mais ativo. Entre novamente.' });
    }

    req.usuario = usuario;
    next();
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

/** Rotas de administração: só usuário na tela, nunca chave de API */
export function exigirUsuario(req: Request, res: Response, next: NextFunction) {
  if (!req.usuario?.id) return res.status(403).json({ success: false, error: 'Disponível só para usuários na tela do BMBancos, não para chave de API.' });
  next();
}

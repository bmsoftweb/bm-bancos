import { Empresa, Usuario } from '../types';

/**
 * Sessão e "Lembrar neste dispositivo", no mesmo desenho do painel B2B:
 * marcado grava no localStorage, desmarcado no sessionStorage. A senha nunca
 * é guardada; o que autentica as chamadas é o token do login, que vence em 12 horas.
 */

const SESSAO_USUARIO = 'bmbancos_session_user';
const SESSAO_EMPRESA = 'bmbancos_session_empresa';
const SESSAO_TOKEN = 'bmbancos_session_token';
const CHAVES_SESSAO = [SESSAO_USUARIO, SESSAO_EMPRESA, SESSAO_TOKEN];
const LEMBRETE = 'bmbancos_lembrar_dispositivo';

export interface LembreteLogin {
  cnpj: string;
  usuario: string;
}

/** O acesso ao storage pode lançar exceção (modo privado, bloqueio de cookies) */
function seguro<T>(fn: () => T, padrao: T): T {
  try {
    return fn();
  } catch {
    return padrao;
  }
}

function lerJson<T>(chave: string): T | null {
  return seguro(() => {
    const bruto = localStorage.getItem(chave) ?? sessionStorage.getItem(chave);
    return bruto ? (JSON.parse(bruto) as T) : null;
  }, null);
}

export function lerSessao(): { usuario: Usuario | null; empresa: Empresa | null; token: string | null } {
  const token = lerJson<string>(SESSAO_TOKEN);
  // Sessão guardada antes da autenticação existir não tem token: vale como deslogado
  if (!token) return { usuario: null, empresa: null, token: null };
  return {
    usuario: lerJson<Usuario>(SESSAO_USUARIO),
    empresa: lerJson<Empresa>(SESSAO_EMPRESA),
    token,
  };
}

export function salvarSessao(usuario: Usuario, empresa: Empresa, token: string, lembrar: boolean) {
  seguro(() => {
    const destino = lembrar ? localStorage : sessionStorage;
    const outro = lembrar ? sessionStorage : localStorage;
    destino.setItem(SESSAO_USUARIO, JSON.stringify(usuario));
    destino.setItem(SESSAO_EMPRESA, JSON.stringify(empresa));
    destino.setItem(SESSAO_TOKEN, JSON.stringify(token));
    // Evita que sobre uma cópia no armazenamento que não foi escolhido
    for (const chave of CHAVES_SESSAO) outro.removeItem(chave);
  }, undefined);
}

export function limparSessao() {
  seguro(() => {
    for (const s of [localStorage, sessionStorage]) {
      for (const chave of CHAVES_SESSAO) s.removeItem(chave);
    }
  }, undefined);
}

export function lerLembrete(): LembreteLogin | null {
  return seguro(() => {
    const bruto = localStorage.getItem(LEMBRETE);
    return bruto ? (JSON.parse(bruto) as LembreteLogin) : null;
  }, null);
}

export function salvarLembrete(dados: LembreteLogin) {
  seguro(() => localStorage.setItem(LEMBRETE, JSON.stringify(dados)), undefined);
}

export function limparLembrete() {
  seguro(() => localStorage.removeItem(LEMBRETE), undefined);
}

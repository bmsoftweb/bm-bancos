import {
  Banco, BoletoDetalhe, BoletoLista, ChaveApi, Conta, Empresa, Lancamento, Ocorrencia, Painel, PedidoBoleto, Remessa, Retorno,
  StatusBanco, Usuario,
} from '../types';

/**
 * Token de sessão devolvido pelo login. Vai em toda requisição no header
 * Authorization; é dele que o servidor tira a empresa.
 */
let token: string | null = null;
let aoExpirar: ((mensagem: string) => void) | null = null;

export function definirToken(novo: string | null) {
  token = novo;
}

/** Chamado quando o servidor recusa a sessão (401), para voltar ao login */
export function aoExpirarSessao(callback: (mensagem: string) => void) {
  aoExpirar = callback;
}

function cabecalhos(): HeadersInit {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/** 401 com sessão aberta significa token vencido ou acesso revogado: volta ao login */
function conferirSessao(status: number, mensagem: string) {
  if (status === 401 && token && aoExpirar) aoExpirar(mensagem);
}

async function pedir<T>(rota: string, opcoes: RequestInit = {}): Promise<T> {
  return lerResposta<T>(await fetch(`/api${rota}`, { ...opcoes, headers: { ...cabecalhos(), ...opcoes.headers } }));
}

/** Corpo JSON da resposta; erro vira exceção com a mensagem do servidor */
async function lerResposta<T>(resposta: Response): Promise<T> {
  const texto = await resposta.text();
  let corpo: any = null;
  try {
    corpo = texto ? JSON.parse(texto) : null;
  } catch {
    corpo = { error: texto };
  }
  if (!resposta.ok) {
    conferirSessao(resposta.status, corpo?.error || 'Sessão expirada. Entre novamente.');
    throw new Error(corpo?.error || `Falha na requisição (${resposta.status}).`);
  }
  return corpo as T;
}

const post = <T>(rota: string, corpo?: any) => pedir<T>(rota, { method: 'POST', body: JSON.stringify(corpo ?? {}) });
const put = <T>(rota: string, corpo?: any) => pedir<T>(rota, { method: 'PUT', body: JSON.stringify(corpo ?? {}) });

/** Andamento de uma ação longa (usado pelo ProgressoModal) */
export interface Andamento {
  etapa: string;
  feitos: number;
  total: number;
}

/** Arquivo escolhido na tela em base64, para ir no corpo JSON */
export const lerArquivoBase64 = (arquivo: File) =>
  new Promise<string>((ok, falha) => {
    const leitor = new FileReader();
    leitor.onload = () => ok(String(leitor.result).replace(/^data:[^,]*,/, ''));
    leitor.onerror = () => falha(new Error('Não foi possível ler o arquivo.'));
    leitor.readAsDataURL(arquivo);
  });

/** Baixa um arquivo da API (com o token) e abre numa aba (PDF) ou salva */
async function baixar(rota: string, abrir: boolean) {
  const resposta = await fetch(`/api${rota}`, { headers: cabecalhos() });
  if (!resposta.ok) {
    const erro = await resposta.json().catch(() => ({ error: `Falha (${resposta.status}).` }));
    conferirSessao(resposta.status, erro.error);
    throw new Error(erro.error);
  }
  const url = URL.createObjectURL(await resposta.blob());
  if (abrir) {
    window.open(url, '_blank');
  } else {
    const nome = resposta.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || 'arquivo';
    Object.assign(document.createElement('a'), { href: url, download: nome }).click();
  }
  // O objeto só pode ser liberado depois que a aba carregou
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ---------------------------------------------------------------------------
// Grades paginadas no servidor (padrão b2b admin)
// ---------------------------------------------------------------------------

export interface ConsultaGrade {
  pagina: number;
  porPagina: number;
  busca: string;
  ordem: string;
  direcao: 'asc' | 'desc';
}

export interface PaginaGrade<T> {
  data: T[];
  total: number;
  totalPages: number;
}

/** Filtros extras de cada tela; vazio não vai na query */
type Filtros = Record<string, string | number | undefined | null>;

const paraQuery = (c: ConsultaGrade, filtros: Filtros = {}) => {
  const q = new URLSearchParams({ pagina: String(c.pagina), porPagina: String(c.porPagina), busca: c.busca, ordem: c.ordem, direcao: c.direcao });
  for (const [k, v] of Object.entries(filtros)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  return q.toString();
};

const grade = <T>(rota: string) => (c: ConsultaGrade, filtros?: Filtros) => pedir<PaginaGrade<T>>(`${rota}?${paraQuery(c, filtros)}`);

// ---------------------------------------------------------------------------
// Sessão e painel
// ---------------------------------------------------------------------------

export const entrar = (cnpj: string, usuario: string, senha: string) =>
  post<{ success: boolean; token: string; usuario: Usuario; empresa: Empresa }>('/login', { cnpj, usuario, senha });

export const buscarPainel = () => pedir<Painel>('/painel');
export const buscarStatusBanco = () => pedir<StatusBanco>('/db/status');

// ---------------------------------------------------------------------------
// Contas de cobrança
// ---------------------------------------------------------------------------

export const listarBancos = () => pedir<Banco[]>('/bancos');
export const listarContas = () => pedir<Conta[]>('/contas');
type RespostaConta = { success: boolean; id?: number; avisos: string[] };
export const incluirConta = (c: Partial<Conta>) => post<RespostaConta>('/contas', c);
export const gravarConta = (id: number, c: Partial<Conta>) => put<RespostaConta>(`/contas/${id}`, c);
export const gravarCredenciais = (
  id: number,
  c: { clientId: string; clientSecret?: string; chaveAplicacao?: string; certificadoBase64?: string; certificadoNome?: string; certificadoSenha?: string },
) => put<{ success: boolean }>(`/contas/${id}/credenciais`, c);
export const removerCredenciais = (id: number) => pedir<{ success: boolean }>(`/contas/${id}/credenciais`, { method: 'DELETE' });
export const buscarMovimento = (id: number) => post<{ success: boolean; novas: number; repetidas: number; semBoleto: number }>(`/contas/${id}/movimento`);

// ---------------------------------------------------------------------------
// Boletos
// ---------------------------------------------------------------------------

export const listarBoletos = grade<BoletoLista>('/boletos');
export const buscarBoleto = (id: number) => pedir<BoletoDetalhe>(`/boletos/${id}`);
export const emitirBoleto = (p: PedidoBoleto) => post<{ success: boolean; repetida: boolean; boleto: BoletoDetalhe }>('/boletos', p);
export const registrarBoleto = (id: number) => post<{ success: boolean; boleto: BoletoDetalhe }>(`/boletos/${id}/registrar`);
export const instruirBoleto = (id: number, tipo: string, dados: Record<string, unknown> = {}) =>
  post<{ success: boolean; local: boolean; boleto: BoletoDetalhe }>(`/boletos/${id}/instrucoes`, { tipo, dados });
export const abrirPdf = (id: number) => baixar(`/boletos/${id}/pdf`, true);

// ---------------------------------------------------------------------------
// Remessas, retornos e ocorrências
// ---------------------------------------------------------------------------

export const listarRemessas = grade<Remessa>('/remessas');
export const gerarRemessa = (contaId: number) => post<{ success: boolean; id: number; numero: number; boletos: number; instrucoes: number }>('/remessas', { contaId });
export const baixarRemessa = (id: number) => baixar(`/remessas/${id}/arquivo`, false);
export const marcarRemessaEnviada = (id: number) => post<{ success: boolean }>(`/remessas/${id}/enviada`);
export const cancelarRemessa = (id: number) => post<{ success: boolean }>(`/remessas/${id}/cancelar`);

export const listarRetornos = grade<Retorno>('/retornos');
export const importarRetorno = (contaId: number, nomeArquivo: string, conteudoBase64: string) =>
  post<{ success: boolean; novas: number; repetidas: number; semBoleto: number }>('/retornos', { contaId, nomeArquivo, conteudoBase64 });
export const baixarRetorno = (id: number) => baixar(`/retornos/${id}/arquivo`, false);

export const listarOcorrencias = grade<Ocorrencia>('/ocorrencias');

// ---------------------------------------------------------------------------
// Extratos e conciliação
// ---------------------------------------------------------------------------

export const listarLancamentos = grade<Lancamento>('/extratos/lancamentos');
export const importarOfx = (contaId: number, nomeArquivo: string, conteudoBase64: string) =>
  post<{ success: boolean; lancamentos: number; novos: number; repetidos: number; vinculados: number }>('/extratos', { contaId, nomeArquivo, conteudoBase64 });
export const marcarLancamento = (id: number, acao: 'conciliar' | 'ignorar' | 'desfazer', referencia?: string) =>
  post<{ success: boolean }>(`/extratos/lancamentos/${id}/${acao}`, { referencia });

// ---------------------------------------------------------------------------
// Chaves de API e log
// ---------------------------------------------------------------------------

export const listarChaves = () => pedir<ChaveApi[]>('/chaves');
export const criarChave = (nome: string) => post<{ success: boolean; chave: string }>('/chaves', { nome });
export const revogarChave = (id: number) => post<{ success: boolean }>(`/chaves/${id}/revogar`);

export const listarLog = grade<any>('/log');
export const buscarLog = (id: number) => pedir<any>(`/log/${id}`);

// ---------------------------------------------------------------------------
// Preferências das grades
// ---------------------------------------------------------------------------

export const buscarConfigListas = () => pedir<Record<string, unknown>>('/config-listas');
export const gravarConfigListas = (config: Record<string, unknown>) => put<{ success: boolean }>('/config-listas', config);

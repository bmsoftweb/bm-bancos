/**
 * Cobrança PIX imediata (API Pix do Bacen: POST/PUT /cob, GET e PATCH /cob/{txid}) para os principais bancos.
 * O contrato é o mesmo em todos; muda por banco só o que está na tabela PSPS: endereços, como pedir o token,
 * cabeçalhos/chaves extras e uns poucos desvios. Banco novo = uma linha aqui.
 *
 * Endereços e desvios tirados do ACBr (Fontes/ACBrPIXCD/ACBrPIXPSP*.pas). Ficaram de fora: Ailos (o token
 * leva caminhos de arquivo), Mercado Pago, PagSeguro e afins (API própria, fora do padrão do Bacen).
 */
import crypto from 'crypto';
import type { ClienteApi, Conta, Credenciais, RespostaHttp } from '../boleto/tipos.js';

/** Cobrança PIX imediata como o BMBancos devolve aos módulos */
export interface CobrancaPix {
  txid: string;
  /** ATIVA (esperando), CONCLUIDA (paga), REMOVIDA_PELO_USUARIO_RECEBEDOR ou REMOVIDA_PELO_PSP (vencida) */
  status: string;
  valor: number;
  /** BR Code (copia e cola), de onde sai o QR Code */
  pixCopiaECola?: string;
  /** Pagamento recebido: identificador fim a fim e data/hora (ISO, como o banco manda) */
  endToEndId?: string;
  pagoEm?: string;
}

type PorAmbiente = { 1: string; 2: string };

export interface Psp {
  codigo: string;
  nome: string;
  /** CNPJ da instituição, para a NFC-e (grupo de cartão do PIX); a conta pode trocar em config.cnpjPsp */
  cnpj: string;
  /** Base da API Pix (o /cob fica abaixo): 1 produção, 2 homologação */
  api: PorAmbiente;
  token: PorAmbiente;
  /** client_id/client_secret no Authorization Basic ou no corpo do pedido de token */
  autenticacao: 'basic' | 'corpo';
  escopo?: string;
  /** Pedido de token em JSON em vez de form (Efí) */
  tokenJson?: boolean;
  /** grant_type na URL do token, fora do corpo (Santander) */
  grantNaUrl?: boolean;
  /** Homologação sem pedido de token: o token fixo do portal vai no lugar do client_secret (Sicoob) */
  tokenFixoHomologacao?: boolean;
  /** Sem POST /cob: o txid é gerado aqui e a cobrança criada com PUT /cob/{txid} (Santander) */
  txidProprio?: boolean;
  /** Base própria para o PATCH (Santander usa v2 só nele) */
  apiPatch?: PorAmbiente;
  /** Chave além do OAuth (ban_credenciais.chave_aplicacao): nome na tela e onde vai */
  chave?: { rotulo: string; query?: string; cabecalho?: string };
  /** Cabeçalhos a mais em toda chamada (API e token) */
  cabecalhos?: (c: Credenciais) => Record<string, string>;
  /** Cabeçalho que repete o token em homologação (Itaú: x-sandbox-token) */
  tokenHomologacaoEm?: string;
  /** Rótulo do client_secret na tela, quando o banco chama de outro jeito; null = não usa */
  rotuloSegredo?: string | null;
  /** Certificado (TLS mútuo) exigido: em produção, ou nunca obrigatório */
  certificado: 'producao' | 'opcional';
}

export const PSPS: Record<string, Psp> = {
  '001': {
    codigo: '001', nome: 'Banco do Brasil', cnpj: '00000000000191',
    api: { 1: 'https://api-pix.bb.com.br/pix/v2', 2: 'https://api.hm.bb.com.br/pix/v2' },
    token: { 1: 'https://oauth.bb.com.br/oauth/token', 2: 'https://oauth.hm.bb.com.br/oauth/token' },
    autenticacao: 'basic', escopo: 'cob.write cob.read',
    chave: { rotulo: 'Chave do aplicativo (gw-dev-app-key)', query: 'gw-dev-app-key' },
    certificado: 'producao',
  },
  '341': {
    codigo: '341', nome: 'Itaú', cnpj: '60701190000104',
    api: { 1: 'https://secure.gateway.api.itau/pix_recebimentos/v2', 2: 'https://devportal.itau.com.br/sandboxapi/pix_recebimentos_ext_v2/v2' },
    token: { 1: 'https://sts.itau.com.br/as/token.oauth2', 2: 'https://devportal.itau.com.br/api/jwt' },
    autenticacao: 'corpo',
    cabecalhos: (c) => ({ 'x-itau-apikey': c.clientId, 'x-itau-correlationID': crypto.randomUUID() }),
    tokenHomologacaoEm: 'x-sandbox-token',
    certificado: 'producao',
  },
  '237': {
    codigo: '237', nome: 'Bradesco', cnpj: '60746948000112',
    api: { 1: 'https://qrpix.bradesco.com.br/v2', 2: 'https://qrpix-h.bradesco.com.br/v2' },
    token: { 1: 'https://qrpix.bradesco.com.br/oauth/token', 2: 'https://qrpix-h.bradesco.com.br/oauth/token' },
    autenticacao: 'basic',
    certificado: 'producao',
  },
  '033': {
    codigo: '033', nome: 'Santander', cnpj: '90400888000142',
    // Homologação = pré-produção (o sandbox do Santander troca PUT por POST e devolve lista)
    api: { 1: 'https://trust-pix.santander.com.br/api/v1', 2: 'https://trust-pix-h.santander.com.br/api/v1' },
    apiPatch: { 1: 'https://trust-pix.santander.com.br/api/v2', 2: 'https://trust-pix-h.santander.com.br/api/v2' },
    token: { 1: 'https://trust-pix.santander.com.br/oauth/token', 2: 'https://trust-pix-h.santander.com.br/oauth/token' },
    autenticacao: 'corpo', grantNaUrl: true, txidProprio: true,
    certificado: 'producao',
  },
  '104': {
    codigo: '104', nome: 'Caixa', cnpj: '00360305000104',
    // ponytail: caminho tal como no ACBr (pix-automatico); conferir na homologação da Caixa
    api: {
      1: 'https://api.caixa.gov.br:8443/servicos-bancarios/requisicoes/pix-automatico',
      2: 'https://api.caixa.gov.br:8443/sandbox/servicos-bancarios/requisicoes/pix-automatico',
    },
    token: {
      1: 'https://loginservicos.caixa.gov.br/auth/realms/internet/protocol/openid-connect/token',
      2: 'https://logindes.caixa.gov.br/auth/realms/internet/protocol/openid-connect/token',
    },
    autenticacao: 'corpo', escopo: 'cob.write cob.read',
    chave: { rotulo: 'API key (apikey)', cabecalho: 'apikey' },
    certificado: 'producao',
  },
  '756': {
    codigo: '756', nome: 'Sicoob', cnpj: '02038232000164',
    api: { 1: 'https://api.sicoob.com.br/pix/api/v2', 2: 'https://sandbox.sicoob.com.br/sicoob/sandbox/pix/api/v2' },
    token: { 1: 'https://auth.sicoob.com.br/auth/realms/cooperado/protocol/openid-connect/token', 2: '' },
    autenticacao: 'corpo', escopo: 'cob.write cob.read', tokenFixoHomologacao: true,
    cabecalhos: (c) => ({ client_id: c.clientId }),
    rotuloSegredo: 'Token do sandbox (só homologação; em produção o acesso é pelo certificado)',
    certificado: 'producao',
  },
  '748': {
    codigo: '748', nome: 'Sicredi', cnpj: '01181521000155',
    api: { 1: 'https://api-pix.sicredi.com.br/api/v2', 2: 'https://api-pix-h.sicredi.com.br/api/v2' },
    token: { 1: 'https://api-pix.sicredi.com.br/oauth/token', 2: 'https://api-pix-h.sicredi.com.br/oauth/token' },
    autenticacao: 'basic', escopo: 'cob.write cob.read',
    certificado: 'producao',
  },
  '077': {
    codigo: '077', nome: 'Inter', cnpj: '00416968000101',
    api: { 1: 'https://cdpj.partners.bancointer.com.br/pix/v2', 2: 'https://cdpj-sandbox.partners.uatinter.co/pix/v2' },
    token: { 1: 'https://cdpj.partners.bancointer.com.br/oauth/v2/token', 2: 'https://cdpj-sandbox.partners.uatinter.co/oauth/v2/token' },
    autenticacao: 'corpo', escopo: 'cob.write cob.read',
    certificado: 'producao',
  },
  '041': {
    codigo: '041', nome: 'Banrisul', cnpj: '92702067000196',
    api: { 1: 'https://mtls-api.banrisul.com.br/pix/api-mtls', 2: 'https://mtls-api-h.banrisul.com.br/pix/api-mtls' },
    token: { 1: 'https://mtls-api.banrisul.com.br/auth/oauth/v2/token', 2: 'https://mtls-api-h.banrisul.com.br/auth/oauth/v2/token' },
    autenticacao: 'corpo', escopo: 'cob.write cob.read',
    certificado: 'producao',
  },
  '336': {
    codigo: '336', nome: 'C6 Bank', cnpj: '31872495000172',
    api: { 1: 'https://baas-api.c6bank.info/v2/pix', 2: 'https://baas-api-sandbox.c6bank.info/v2/pix' },
    token: { 1: 'https://baas-api.c6bank.info/v1/auth', 2: 'https://baas-api-sandbox.c6bank.info/v1/auth' },
    autenticacao: 'basic',
    certificado: 'producao',
  },
  '364': {
    codigo: '364', nome: 'Efí (Gerencianet)', cnpj: '09089356000118',
    api: { 1: 'https://pix.api.efipay.com.br/v2', 2: 'https://pix-h.api.efipay.com.br/v2' },
    token: { 1: 'https://pix.api.efipay.com.br/oauth/token', 2: 'https://pix-h.api.efipay.com.br/oauth/token' },
    autenticacao: 'basic', tokenJson: true,
    certificado: 'producao',
  },
};

const TXID = /^[A-Za-z0-9]{26,35}$/;
const ok = (r: RespostaHttp) => r.status >= 200 && r.status < 300;

/** Mensagem do banco: problem+json (title/detail/violacoes), erros[] do BB, error_description... */
function falha(psp: Psp, r: RespostaHttp, oque: string): Error {
  const c = r.corpo && typeof r.corpo === 'object' ? r.corpo : {};
  const lista = [...(Array.isArray(c.erros) ? c.erros : []), ...(Array.isArray(c.errors) ? c.errors : []), ...(Array.isArray(c.violacoes) ? c.violacoes : [])]
    .map((e: any) => String(e?.mensagem || e?.message || e?.razao || e?.textoMensagem || '').trim())
    .filter(Boolean);
  const principal = String(c.detail || c.title || c.error_description || c.message || c.error || '').trim();
  const msgs = [principal, ...lista].filter(Boolean);
  if (!msgs.length) msgs.push(typeof r.corpo === 'string' && r.corpo.trim() ? r.corpo.trim().slice(0, 200) : 'sem detalhe');
  return new Error(`${psp.nome}: ${oque} falhou (HTTP ${r.status}): ${msgs.join('; ')}`);
}

export function lerCobranca(c: any): CobrancaPix {
  const pago = Array.isArray(c?.pix) ? c.pix[0] : undefined;
  return {
    txid: String(c?.txid || ''),
    status: String(c?.status || ''),
    valor: Number(c?.valor?.original) || 0,
    // Nomes antigos do copia e cola: textoImagemQRcode (BB v1), brcode (Sicoob)
    pixCopiaECola: c?.pixCopiaECola || c?.textoImagemQRcode || c?.brcode || undefined,
    ...(pago && { endToEndId: String(pago.endToEndId || ''), pagoEm: String(pago.horario || '') }),
  };
}

async function tokenDe(psp: Psp, cli: ClienteApi, amb: 1 | 2): Promise<string> {
  if (amb === 2 && psp.tokenFixoHomologacao) {
    if (!cli.credenciais.clientSecret) throw new Error(`${psp.nome}: informe o token do sandbox nas credenciais da conta.`);
    return cli.credenciais.clientSecret;
  }
  return cli.oauth({
    url: psp.grantNaUrl ? `${psp.token[amb]}?grant_type=client_credentials` : psp.token[amb],
    escopo: psp.escopo,
    autenticacao: psp.autenticacao,
    json: psp.tokenJson,
    semGrantNoCorpo: psp.grantNaUrl,
    semSegredo: psp.tokenFixoHomologacao,
    cabecalhos: psp.cabecalhos?.(cli.credenciais),
  });
}

async function chamar(psp: Psp, cli: ClienteApi, conta: Conta, metodo: 'GET' | 'POST' | 'PUT' | 'PATCH', caminho: string, operacao: string, corpo?: unknown) {
  const amb = conta.ambiente === 1 ? 1 : 2;
  const token = await tokenDe(psp, cli, amb);
  const chaveApp = cli.credenciais.chaveAplicacao;
  if (psp.chave && !chaveApp) throw new Error(`${psp.nome}: informe a ${psp.chave.rotulo} nas credenciais da conta.`);
  const qs = psp.chave?.query ? `?${new URLSearchParams({ [psp.chave.query]: chaveApp })}` : '';
  const base = (metodo === 'PATCH' && psp.apiPatch ? psp.apiPatch : psp.api)[amb];
  return cli.pedir({
    metodo,
    url: `${base}${caminho}${qs}`,
    corpo,
    operacao,
    cabecalhos: {
      Authorization: `Bearer ${token}`,
      ...psp.cabecalhos?.(cli.credenciais),
      ...(psp.chave?.cabecalho && { [psp.chave.cabecalho]: chaveApp }),
      ...(amb === 2 && psp.tokenHomologacaoEm && { [psp.tokenHomologacaoEm]: token }),
    },
  });
}

const conferirTxid = (txid: string) => {
  if (!TXID.test(txid)) throw new Error('Identificador da cobrança PIX (txid) inválido.');
};

/** Cria a cobrança na chave PIX da conta (config.chavePix), válida por `expiracao` segundos */
export async function cobrar(psp: Psp, cli: ClienteApi, conta: Conta, valor: number, expiracao: number, descricao?: string): Promise<CobrancaPix> {
  const chave = String(conta.config.chavePix || '').trim();
  if (!chave) throw new Error('A conta não tem chave PIX: preencha em Contas › Editar › Chave PIX.');
  if (!(valor > 0)) throw new Error('Valor da cobrança PIX inválido.');
  const corpo = {
    calendario: { expiracao },
    valor: { original: valor.toFixed(2) },
    chave,
    ...(descricao ? { solicitacaoPagador: descricao.slice(0, 140) } : {}),
  };
  const r = psp.txidProprio
    ? await chamar(psp, cli, conta, 'PUT', `/cob/${crypto.randomBytes(16).toString('hex')}`, 'pix-cobrar', corpo)
    : await chamar(psp, cli, conta, 'POST', '/cob', 'pix-cobrar', corpo);
  if (!ok(r)) throw falha(psp, r, 'criação da cobrança PIX');
  const c = lerCobranca(r.corpo);
  if (!TXID.test(c.txid) || !c.pixCopiaECola) throw new Error(`${psp.nome}: a cobrança PIX voltou sem o txid ou sem o copia e cola.`);
  return c;
}

export async function consultar(psp: Psp, cli: ClienteApi, conta: Conta, txid: string): Promise<CobrancaPix> {
  conferirTxid(txid);
  const r = await chamar(psp, cli, conta, 'GET', `/cob/${txid}`, 'pix-consultar');
  if (!ok(r)) throw falha(psp, r, 'consulta da cobrança PIX');
  return lerCobranca(r.corpo);
}

/** Tira a cobrança do ar; se ela já foi paga, devolve CONCLUIDA */
export async function cancelar(psp: Psp, cli: ClienteApi, conta: Conta, txid: string): Promise<CobrancaPix> {
  conferirTxid(txid);
  const r = await chamar(psp, cli, conta, 'PATCH', `/cob/${txid}`, 'pix-cancelar', { status: 'REMOVIDA_PELO_USUARIO_RECEBEDOR' });
  if (ok(r)) return lerCobranca(r.corpo);
  // Paga (ou já removida) no meio do caminho: o banco recusa a alteração e vale a situação atual
  const c = await consultar(psp, cli, conta, txid);
  if (c.status === 'ATIVA') throw falha(psp, r, 'cancelamento da cobrança PIX');
  return c;
}

/** CNPJ do PSP para a NFC-e: o da conta (cooperativas) ou o da tabela */
export const cnpjDoPsp = (psp: Psp, conta: Conta) => String(conta.config.cnpjPsp || '').replace(/\D/g, '') || psp.cnpj;

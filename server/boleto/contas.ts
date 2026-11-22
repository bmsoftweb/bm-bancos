/**
 * Conta de cobrança (ban_contas + beneficiário em sys_empresas) e o cliente
 * da API dela (credenciais decifradas e certificado aberto).
 */
import { pool } from '../db.js';
import { moduloDoBanco } from '../bancos/index.js';
import { PSPS, Psp } from '../bancos/pix.js';
import { carregarPem, carregarPfx, CertificadoCarregado } from './certificado.js';
import { decifrar } from './cripto.js';
import { criarClienteApi } from './http.js';
import { ClienteApi, Conta, ModuloBanco } from './tipos.js';

/**
 * Certificado gravado em ban_credenciais: .pfx com a senha cifrada, ou PEM (certificado + chave) cifrado
 * inteiro, sem senha (a chave PEM não tem senha própria).
 */
export function abrirCertificado(arquivo: Buffer, senhaCifrada: string | null): CertificadoCarregado {
  return senhaCifrada ? carregarPfx(arquivo, decifrar(senhaCifrada)) : carregarPem(decifrar(arquivo.toString('utf8')));
}

const lerJson = (v: unknown) => (typeof v === 'string' ? JSON.parse(v || '{}') : v || {});

export function linhaParaConta(c: any): Conta {
  return {
    id: Number(c.id),
    empresaId: Number(c.empresa_id),
    bancoCodigo: c.banco_codigo,
    agencia: c.agencia || '',
    agenciaDv: c.agencia_dv || '',
    conta: c.conta || '',
    contaDv: c.conta_dv || '',
    beneficiario: c.beneficiario || '',
    beneficiarioDv: c.beneficiario_dv || '',
    convenio: c.convenio || '',
    carteira: c.carteira || '',
    layoutCnab: c.layout_cnab || null,
    canal: c.canal === 'api' ? 'api' : 'remessa',
    ambiente: Number(c.ambiente) === 1 ? 1 : 2,
    config: lerJson(c.config),
    empresa: {
      cnpj: c.e_cnpj || '',
      razaoSocial: c.e_razao_social || '',
      logradouro: c.e_logradouro || '',
      numero: c.e_numero || '',
      complemento: c.e_complemento || '',
      bairro: c.e_bairro || '',
      cidade: c.e_cidade || '',
      uf: c.e_uf || '',
      cep: c.e_cep || '',
    },
  };
}

export const SELECT_CONTA = `
  SELECT c.*, e.cnpj AS e_cnpj, e.razao_social AS e_razao_social, e.logradouro AS e_logradouro, e.numero AS e_numero,
         e.complemento AS e_complemento, e.bairro AS e_bairro, e.cidade AS e_cidade, e.uf AS e_uf, e.cep AS e_cep
    FROM ban_contas c JOIN sys_empresas e ON e.id = c.empresa_id`;

/** Conta da empresa, sem exigir módulo de boleto (contas só de PIX) */
export async function lerConta(empresaId: number, contaId: number): Promise<{ conta: Conta; ativa: boolean }> {
  const [linhas] = await pool.query<any[]>(`${SELECT_CONTA} WHERE c.id = ? AND c.empresa_id = ? LIMIT 1`, [contaId, empresaId]);
  if (!linhas.length) throw new Error(`Conta ${contaId} não encontrada.`);
  return { conta: linhaParaConta(linhas[0]), ativa: !!linhas[0].ativo };
}

/** Conta de cobrança com o módulo de boleto do banco */
export async function carregarConta(empresaId: number, contaId: number): Promise<{ conta: Conta; modulo: ModuloBanco; ativa: boolean }> {
  const { conta, ativa } = await lerConta(empresaId, contaId);
  return { conta, modulo: moduloDoBanco(conta.bancoCodigo), ativa };
}

/**
 * Conta que recebe a cobrança PIX: a indicada (contaId) ou, sem ela, a única conta ativa da empresa com chave
 * PIX num banco que cobra PIX. Mais de uma com chave = o módulo precisa dizer qual.
 */
export async function contaPix(empresaId: number, contaId?: number): Promise<{ conta: Conta; psp: Psp }> {
  const [linhas] = await pool.query<any[]>(
    `${SELECT_CONTA} WHERE c.empresa_id = ? AND c.ativo = 1${contaId ? ' AND c.id = ?' : ''}`,
    contaId ? [empresaId, contaId] : [empresaId],
  );
  const aptas = linhas.map(linhaParaConta).filter((c) => String(c.config.chavePix || '').trim() && PSPS[c.bancoCodigo]);
  if (contaId && !aptas.length) throw new Error(`Conta ${contaId} não encontrada, inativa ou sem chave PIX.`);
  if (!aptas.length) throw new Error('Nenhuma conta ativa com chave PIX: preencha a chave PIX na conta do banco (Contas › Editar).');
  if (aptas.length > 1) throw new Error(`Mais de uma conta com chave PIX (${aptas.map((c) => c.id).join(', ')}): deixe a chave só na conta que recebe o PIX do PDV.`);
  return { conta: aptas[0], psp: PSPS[aptas[0].bancoCodigo] };
}

/** Certificado aberto em PEM por conta; refeito quando a linha muda */
const certificados = new Map<number, { versao: string; cert: string; chave: string }>();

export function esquecerCertificadoConta(contaId: number) {
  certificados.delete(contaId);
}

export async function clienteDaConta(conta: Conta, referencia?: string | null): Promise<ClienteApi> {
  const [linhas] = await pool.query<any[]>('SELECT * FROM ban_credenciais WHERE conta_id = ? LIMIT 1', [conta.id]);
  const c = linhas[0];
  if (!c?.client_id) throw new Error('A conta não tem credenciais da API: cadastre em Contas › Credenciais da API.');

  let pem = certificados.get(conta.id);
  const versao = String(c.atualizado_em || '');
  if (c.certificado && (!pem || pem.versao !== versao)) {
    const aberto = abrirCertificado(Buffer.from(c.certificado), c.certificado_senha);
    pem = { versao, cert: [aberto.certificadoPem, ...aberto.cadeiaPem].join('\n'), chave: aberto.chavePrivadaPem };
    certificados.set(conta.id, pem);
  }

  return criarClienteApi({
    empresaId: conta.empresaId,
    contaId: conta.id,
    referencia,
    credenciais: {
      clientId: c.client_id,
      clientSecret: decifrar(c.client_secret),
      chaveAplicacao: decifrar(c.chave_aplicacao),
    },
    certificadoPem: c.certificado ? pem!.cert : undefined,
    chavePem: c.certificado ? pem!.chave : undefined,
  });
}

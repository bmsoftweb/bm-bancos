/**
 * Conta de cobrança (ban_contas + beneficiário em sys_empresas) e o cliente
 * da API dela (credenciais decifradas e certificado aberto).
 */
import { pool } from '../db.js';
import { moduloDoBanco } from '../bancos/index.js';
import { carregarPfx } from './certificado.js';
import { decifrar } from './cripto.js';
import { criarClienteApi } from './http.js';
import { ClienteApi, Conta, ModuloBanco } from './tipos.js';

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

export async function carregarConta(empresaId: number, contaId: number): Promise<{ conta: Conta; modulo: ModuloBanco; ativa: boolean }> {
  const [linhas] = await pool.query<any[]>(`${SELECT_CONTA} WHERE c.id = ? AND c.empresa_id = ? LIMIT 1`, [contaId, empresaId]);
  if (!linhas.length) throw new Error(`Conta de cobrança ${contaId} não encontrada.`);
  const conta = linhaParaConta(linhas[0]);
  return { conta, modulo: moduloDoBanco(conta.bancoCodigo), ativa: !!linhas[0].ativo };
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
    const aberto = carregarPfx(Buffer.from(c.certificado), decifrar(c.certificado_senha));
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

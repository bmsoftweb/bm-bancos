/**
 * Teste da cobrança PIX (API Pix do Bacen) com a tabela de bancos, sem rede e sem banco de dados:
 *   npx tsx server/bancos/pix.teste.ts
 */
import assert from 'node:assert/strict';
import forge from 'node-forge';
import { carregarPem } from '../boleto/certificado.js';
import type { ClienteApi, Conta, RespostaHttp } from '../boleto/tipos.js';
import { cancelar, cnpjDoPsp, cobrar, consultar, PSPS } from './pix.js';

const ok = (msg: string) => console.log(`  ok  ${msg}`);

function clienteFalso(respostas: Partial<RespostaHttp>[], credenciais = { clientId: 'ID', clientSecret: 'SEGREDO', chaveAplicacao: 'CHAVE' }) {
  const pedidos: Parameters<ClienteApi['pedir']>[0][] = [];
  const tokens: Parameters<ClienteApi['oauth']>[0][] = [];
  const cli: ClienteApi = {
    credenciais,
    async oauth(o) {
      tokens.push(o);
      return 'TOKEN';
    },
    async pedir(o) {
      pedidos.push(o);
      return { status: 200, corpo: null, texto: '', ...respostas.shift() };
    },
  };
  return { cli, pedidos, tokens };
}

const conta = (banco: string, ambiente: 1 | 2 = 2, config: Conta['config'] = { chavePix: 'chave@empresa.com.br' }): Conta => ({
  id: 1, empresaId: 0, bancoCodigo: banco, agencia: '1', agenciaDv: '', conta: '1', contaDv: '', beneficiario: '', beneficiarioDv: '',
  convenio: '', carteira: '', layoutCnab: null, canal: 'remessa', ambiente, config,
  empresa: { cnpj: '', razaoSocial: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '', cep: '' },
});

const TX = 'Ab12Cd34Ef56Gh78Ij90Kl12Mn';
const ativa = (extra: object = {}) => ({ status: 201, corpo: { txid: TX, status: 'ATIVA', valor: { original: '12.34' }, pixCopiaECola: '000201PIX', ...extra } });

/** DV do CNPJ (módulo 11) */
function cnpjValido(c: string) {
  if (!/^\d{14}$/.test(c) || /^(\d)\1+$/.test(c)) return false;
  const dv = (n: number) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = pesos.reduce((s, p, i) => s + p * Number(c[i]), 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(c[12]) && dv(13) === Number(c[13]);
}

// ---------------------------------------------------------------------------
console.log('(1) tabela de bancos');
// ---------------------------------------------------------------------------
for (const p of Object.values(PSPS)) {
  assert.ok(cnpjValido(p.cnpj), `CNPJ inválido em ${p.nome}`);
  assert.equal(PSPS[p.codigo], p);
  for (const amb of [1, 2] as const) assert.match(p.api[amb], /^https:\/\/[^ ]+[^/]$/, `${p.nome}: base da API ${amb}`);
}
assert.deepEqual(Object.keys(PSPS).sort(), ['001', '033', '041', '077', '104', '237', '336', '341', '364', '748', '756']);
assert.equal(cnpjDoPsp(PSPS['756'], conta('756', 2, { chavePix: 'x', cnpjPsp: '11.222.333/0001-81' })), '11222333000181');
ok(`${Object.keys(PSPS).length} bancos, CNPJs com DV válido, bases sem barra final; a conta troca o CNPJ (cooperativas)`);

// ---------------------------------------------------------------------------
console.log('(2) Banco do Brasil: Basic + escopo, gw-dev-app-key na URL');
// ---------------------------------------------------------------------------
await assert.rejects(cobrar(PSPS['001'], clienteFalso([]).cli, conta('001', 2, {}), 10, 600), /não tem chave PIX/);
const bb = clienteFalso([ativa(), { status: 200, corpo: { txid: TX, status: 'CONCLUIDA', valor: { original: '12.34' }, pix: [{ endToEndId: 'E00000000202611201200abcdef12345', horario: '2026-11-20T12:00:00Z' }] } }]);
const cob = await cobrar(PSPS['001'], bb.cli, conta('001'), 12.34, 600, 'Caixa 1');
assert.deepEqual(bb.tokens[0], { url: 'https://oauth.hm.bb.com.br/oauth/token', escopo: 'cob.write cob.read', autenticacao: 'basic', json: undefined, semGrantNoCorpo: undefined, semSegredo: undefined, cabecalhos: undefined });
assert.equal(bb.pedidos[0].metodo, 'POST');
assert.equal(bb.pedidos[0].url, 'https://api.hm.bb.com.br/pix/v2/cob?gw-dev-app-key=CHAVE');
assert.deepEqual(bb.pedidos[0].corpo, { calendario: { expiracao: 600 }, valor: { original: '12.34' }, chave: 'chave@empresa.com.br', solicitacaoPagador: 'Caixa 1' });
assert.deepEqual(bb.pedidos[0].cabecalhos, { Authorization: 'Bearer TOKEN' });
assert.deepEqual(cob, { txid: TX, status: 'ATIVA', valor: 12.34, pixCopiaECola: '000201PIX' });
const paga = await consultar(PSPS['001'], bb.cli, conta('001'), TX);
assert.equal(bb.pedidos[1].url, `https://api.hm.bb.com.br/pix/v2/cob/${TX}?gw-dev-app-key=CHAVE`);
assert.equal(paga.status, 'CONCLUIDA');
assert.equal(paga.endToEndId, 'E00000000202611201200abcdef12345');
await assert.rejects(consultar(PSPS['001'], bb.cli, conta('001'), 'curto'), /txid/);
await assert.rejects(cobrar(PSPS['001'], clienteFalso([], { clientId: 'ID', clientSecret: 'S', chaveAplicacao: '' }).cli, conta('001'), 1, 600), /gw-dev-app-key/);
const bbProd = clienteFalso([ativa({ pixCopiaECola: undefined, textoImagemQRcode: '000201V1' })]);
assert.equal((await cobrar(PSPS['001'], bbProd.cli, conta('001', 1), 1, 600)).pixCopiaECola, '000201V1');
assert.equal(bbProd.pedidos[0].url, 'https://api-pix.bb.com.br/pix/v2/cob?gw-dev-app-key=CHAVE');
ok('POST /cob, consulta com endToEndId, txid inválido e chave do aplicativo faltando recusados, produção em api-pix');

// ---------------------------------------------------------------------------
console.log('(3) desvios por banco');
// ---------------------------------------------------------------------------
const it = clienteFalso([ativa()]);
await cobrar(PSPS['341'], it.cli, conta('341'), 5, 600);
assert.equal(it.tokens[0].autenticacao, 'corpo');
assert.equal(it.tokens[0].escopo, undefined);
assert.equal(it.tokens[0].cabecalhos?.['x-itau-apikey'], 'ID');
assert.equal(it.pedidos[0].cabecalhos?.['x-itau-apikey'], 'ID');
assert.match(it.pedidos[0].cabecalhos?.['x-itau-correlationID'] || '', /^[0-9a-f-]{36}$/);
assert.equal(it.pedidos[0].cabecalhos?.['x-sandbox-token'], 'TOKEN');
const itProd = clienteFalso([ativa()]);
await cobrar(PSPS['341'], itProd.cli, conta('341', 1), 5, 600);
assert.equal(itProd.pedidos[0].cabecalhos?.['x-sandbox-token'], undefined);
assert.equal(itProd.pedidos[0].url, 'https://secure.gateway.api.itau/pix_recebimentos/v2/cob');
ok('Itaú: client_id/secret no corpo, x-itau-apikey e correlationID, x-sandbox-token só na homologação');

const st = clienteFalso([ativa(), { status: 200, corpo: { txid: TX, status: 'REMOVIDA_PELO_USUARIO_RECEBEDOR', valor: { original: '1' } } }]);
await cobrar(PSPS['033'], st.cli, conta('033', 1), 5, 600);
assert.equal(st.pedidos[0].metodo, 'PUT');
assert.match(st.pedidos[0].url, /^https:\/\/trust-pix\.santander\.com\.br\/api\/v1\/cob\/[0-9a-f]{32}$/);
assert.equal(st.tokens[0].url, 'https://trust-pix.santander.com.br/oauth/token?grant_type=client_credentials');
assert.equal(st.tokens[0].semGrantNoCorpo, true);
await cancelar(PSPS['033'], st.cli, conta('033', 1), TX);
assert.equal(st.pedidos[1].metodo, 'PATCH');
assert.equal(st.pedidos[1].url, `https://trust-pix.santander.com.br/api/v2/cob/${TX}`);
ok('Santander: PUT /cob/{txid} gerado aqui, grant_type na URL do token, PATCH na v2');

const sc = clienteFalso([ativa({ pixCopiaECola: undefined, brcode: '000201SICOOB' })], { clientId: 'ID', clientSecret: 'TOKEN-SANDBOX', chaveAplicacao: '' });
assert.equal((await cobrar(PSPS['756'], sc.cli, conta('756'), 5, 600)).pixCopiaECola, '000201SICOOB');
assert.equal(sc.tokens.length, 0);
assert.deepEqual(sc.pedidos[0].cabecalhos, { Authorization: 'Bearer TOKEN-SANDBOX', client_id: 'ID' });
await assert.rejects(cobrar(PSPS['756'], clienteFalso([], { clientId: 'ID', clientSecret: '', chaveAplicacao: '' }).cli, conta('756'), 5, 600), /token do sandbox/);
const scProd = clienteFalso([ativa()]);
await cobrar(PSPS['756'], scProd.cli, conta('756', 1), 5, 600);
assert.equal(scProd.tokens[0].semSegredo, true);
assert.equal(scProd.tokens[0].url, 'https://auth.sicoob.com.br/auth/realms/cooperado/protocol/openid-connect/token');
ok('Sicoob: token fixo no sandbox, client_id no cabeçalho, brcode vira copia e cola, produção sem client_secret');

const cx = clienteFalso([ativa()]);
await cobrar(PSPS['104'], cx.cli, conta('104'), 5, 600);
assert.equal(cx.pedidos[0].cabecalhos?.apikey, 'CHAVE');
assert.ok(!cx.pedidos[0].url.includes('?'));
const ef = clienteFalso([ativa()]);
await cobrar(PSPS['364'], ef.cli, conta('364'), 5, 600);
assert.equal(ef.tokens[0].json, true);
assert.equal(ef.tokens[0].autenticacao, 'basic');
ok('Caixa: apikey no cabeçalho; Efí: token em JSON com Basic');

// ---------------------------------------------------------------------------
console.log('(4) cancelamento e erros');
// ---------------------------------------------------------------------------
const c1 = clienteFalso([
  { status: 400, corpo: { title: 'Cobrança não pode ser alterada' } },
  { status: 200, corpo: { txid: TX, status: 'CONCLUIDA', valor: { original: '12.34' }, pix: [{ endToEndId: 'E1', horario: 'h' }] } },
]);
assert.equal((await cancelar(PSPS['748'], c1.cli, conta('748'), TX)).status, 'CONCLUIDA');
assert.deepEqual(c1.pedidos[0].corpo, { status: 'REMOVIDA_PELO_USUARIO_RECEBEDOR' });
const c2 = clienteFalso([
  { status: 400, corpo: { title: 'Requisição inválida', violacoes: [{ razao: 'status inválido' }] } },
  { status: 200, corpo: { txid: TX, status: 'ATIVA', valor: { original: '12.34' } } },
]);
await assert.rejects(cancelar(PSPS['748'], c2.cli, conta('748'), TX), /Sicredi: cancelamento da cobrança PIX falhou \(HTTP 400\): Requisição inválida; status inválido/);
await assert.rejects(cobrar(PSPS['001'], clienteFalso([{ status: 400, corpo: { erros: [{ mensagem: 'Chave inexistente' }] } }]).cli, conta('001'), 1, 600), /Chave inexistente/);
await assert.rejects(cobrar(PSPS['237'], clienteFalso([{ status: 200, corpo: { txid: TX, status: 'ATIVA' } }]).cli, conta('237'), 1, 600), /sem o txid ou sem o copia e cola/);
ok('cancelar recusado e já paga = CONCLUIDA; ainda ativa = erro com problem+json; erros[] do BB; resposta sem copia e cola');

// ---------------------------------------------------------------------------
console.log('(5) certificado em PEM (Itaú, Inter)');
// ---------------------------------------------------------------------------
const chaves = forge.pki.rsa.generateKeyPair(1024);
const cert = forge.pki.createCertificate();
cert.publicKey = chaves.publicKey;
cert.serialNumber = '01';
cert.validity.notBefore = new Date('2026-01-01');
cert.validity.notAfter = new Date('2027-01-01');
cert.setSubject([{ name: 'commonName', value: 'EMPRESA TESTE:11222333000181' }]);
cert.setIssuer([{ name: 'commonName', value: 'AC TESTE' }]);
cert.sign(chaves.privateKey);
const crt = forge.pki.certificateToPem(cert);
const key = forge.pki.privateKeyToPem(chaves.privateKey);
const aberto = carregarPem(`${crt}\n${key}`);
assert.equal(aberto.info.cnpj, '11222333000181');
assert.equal(aberto.info.validoAte.toISOString().slice(0, 10), '2027-01-01');
assert.equal(aberto.chavePrivadaPem, key.trim());
assert.throws(() => carregarPem(crt), /Falta a chave privada/);
assert.throws(() => carregarPem(key), /Falta o certificado/);
assert.throws(() => carregarPem(`${crt}\n-----BEGIN ENCRYPTED PRIVATE KEY-----\nxx\n-----END ENCRYPTED PRIVATE KEY-----`), /cifrada/);
ok('.crt + .key emendados: validade e CNPJ lidos; sem chave, sem certificado e chave cifrada recusados');

console.log('\nTudo certo.');

/**
 * Autoteste do módulo Sicoob, sem rede nem banco de dados:
 *   npx tsx server/bancos/sicoob.teste.ts
 */
import assert from 'node:assert/strict';
import { deflateRawSync, gzipSync } from 'node:zlib';
import { pos } from '../boleto/cnab.js';
import { codigoBarras, linhaDigitavel } from '../boleto/febraban.js';
import type { Boleto, ClienteApi, Conta, RespostaHttp } from '../boleto/tipos.js';
import { sicoob } from './sicoob.js';

const ok = (msg: string) => console.log(`ok  ${msg}`);

const conta: Conta = {
  id: 1, empresaId: 1, bancoCodigo: '756',
  agencia: '3009', agenciaDv: '', conta: '123456', contaDv: '7',
  beneficiario: '13635', beneficiarioDv: '2', convenio: '', carteira: '1',
  layoutCnab: '240', canal: 'remessa', ambiente: 2, config: { modalidade: '01' },
  empresa: { cnpj: '12345678000195', razaoSocial: 'Empresa Teste Ltda', logradouro: 'Rua A', numero: '10', complemento: '', bairro: 'Centro', cidade: 'Goiânia', uf: 'GO', cep: '74000000' },
};

// ---------------------------------------------------------------------------
// 1) DV do nosso número e campo livre
// ---------------------------------------------------------------------------
assert.deepEqual(sicoob.validarConta(conta), []);

// Memória de cálculo do próprio ACBr: 3009 | 0000136352 | 5931151 -> soma 335, resto 5, DV 6
assert.deepEqual(sicoob.nossoNumero(conta, 5931151), { numero: '5931151', dv: '6' });
// 3009 | 0000136352 | 0000021 -> 9+63+3+3+54+21+15+2+14+3 = 187, resto 0 -> 11 -> DV 0
assert.deepEqual(sicoob.nossoNumero(conta, 21), { numero: '0000021', dv: '0' });
// Exemplo do comentário do ACBr: 0001 | 0000000019 | 0000021 -> 7+3+9+14+3 = 36, resto 3 -> DV 8
const conta2: Conta = { ...conta, agencia: '0001', beneficiario: '1', beneficiarioDv: '9' };
assert.equal(sicoob.nossoNumero(conta2, 21).dv, '8');
// 0001 | 0000000019 | 0000001 -> 19 + 3 = 22, resto 0 -> 11 -> DV 0
assert.equal(sicoob.nossoNumero(conta2, 1).dv, '0');
// 0001 | 0000000019 | 0000005 -> 19 + 15 = 34, resto 1 -> 10 -> DV 0
assert.equal(sicoob.nossoNumero(conta2, 5).dv, '0');
assert.throws(() => sicoob.nossoNumero(conta, 10_000_000), /não cabe em 7/);
ok('DV do nosso número (exemplos do ACBr, resto 0 e resto 1 viram DV 0, limite de 7 dígitos)');

// carteira 1 | coop 3009 | modalidade 01 | cliente 0136352 | NN 5931151 + DV 6 | parcela 001
const campo = sicoob.campoLivre(conta, '5931151', '6');
assert.equal(campo, '1300901013635259311516001');
assert.equal(campo.length, 25);
assert.equal(sicoob.nossoNumeroImpresso(conta, '5931151', '6'), '5931151-6');
assert.equal(sicoob.agenciaCodigoBeneficiario(conta), '3009/13635-2');
assert.equal(sicoob.carteiraImpressa(conta), '1');
assert.ok(sicoob.validarConta({ ...conta, carteira: '9', beneficiario: '12345678' }).length === 2);
ok(`campo livre ${campo}, impresso 5931151-6, beneficiário 3009/13635-2`);

// ---------------------------------------------------------------------------
// 2) Remessa CNAB 240: uma entrada e uma baixa
// ---------------------------------------------------------------------------
const boleto: Boleto = {
  nossoNumero: '5931151', nossoNumeroDv: '6', seuNumero: 'NF123',
  dataEmissao: '2026-11-08', dataVencimento: '2026-12-10', valor: 1500.5,
  pagador: { documento: '12345678909', nome: 'José da Silva', logradouro: 'Rua das Flores', numero: '100', complemento: 'Apto 1', bairro: 'Centro', cidade: 'Goiânia', uf: 'GO', cep: '74000-100', email: 'jose@exemplo.com' },
  especie: 'DM', aceite: 'N',
  multa: { percentual: 2, data: '2026-12-11' },
  juros: { percentualMensal: 1, data: '2026-12-11' },
  desconto: { valor: 10, data: '2026-12-05' },
  diasProtesto: 30,
  mensagens: ['Não receber após 30 dias'],
  pixHibrido: true,
};
const baixa: Boleto = { ...boleto, nossoNumero: '0000021', nossoNumeroDv: '0', seuNumero: 'NF124', valor: 200, multa: undefined, juros: undefined, desconto: undefined, diasProtesto: 0, mensagens: [] };

const texto = sicoob.cnab240.remessa(conta, 123, [{ comando: 'registrar', boleto }, { comando: 'baixar', boleto: baixa }], new Date(2026, 10, 8, 14, 30, 5));
assert.ok(texto.endsWith('\r\n'));
const L = texto.slice(0, -2).split('\r\n');
assert.equal(L.length, 12); // header, lote, 4 segmentos x 2, trailer de lote, trailer de arquivo
L.forEach((l, i) => assert.equal(l.length, 240, `linha ${i + 1} com ${l.length} posições`));

const [ha, hl, p1, q1, r1, s1, p2, q2, , , tl, ta] = L;
const confere = (l: string, de: number, ate: number, esperado: string) => assert.equal(pos(l, de, ate), esperado, `posições ${de}-${ate} de "${l.slice(0, 17)}"`);
// Header de arquivo
confere(ha, 1, 8, '75600000'); confere(ha, 18, 32, '212345678000195'); confere(ha, 54, 58, '30090');
confere(ha, 59, 72, '00000012345670'); confere(ha, 73, 90, 'EMPRESA TESTE LTDA'); confere(ha, 103, 108, 'SICOOB');
confere(ha, 143, 166, '108112026143005000123081');
// Header de lote
confere(hl, 1, 17, '75600011R01  040 '); confere(hl, 19, 33, '012345678000195'); confere(hl, 55, 72, '300900000001234567');
confere(hl, 184, 199, '0000012308112026');
// P da entrada
confere(p1, 8, 17, '300001P 01'); confere(p1, 19, 36, '300900000001234567');
confere(p1, 38, 57, '00593115160101' + '4' + '     '); confere(p1, 58, 62, '10 22');
confere(p1, 63, 77, 'NF123          '); confere(p1, 78, 85, '10122026'); confere(p1, 86, 100, '000000000150050');
confere(p1, 107, 117, '02N08112026');
confere(p1, 118, 141, '2' + '11122026' + '000000000000100'); // juros: taxa mensal 1,00%
confere(p1, 142, 165, '1' + '05122026' + '000000000001000'); // desconto R$ 10,00 até 05/12
confere(p1, 181, 195, '000000000000000');
confere(p1, 196, 220, 'NF123'.padEnd(25)); confere(p1, 221, 229, '1300   09'); confere(p1, 230, 240, '0000000000 ');
// Q da entrada
confere(q1, 8, 18, '300002Q 011'); confere(q1, 19, 33, '000012345678909'); confere(q1, 34, 73, 'JOSE DA SILVA'.padEnd(40));
confere(q1, 74, 113, 'RUA DAS FLORES 100 APTO 1'.padEnd(40)); confere(q1, 129, 136, '74000100'); confere(q1, 137, 153, 'GOIANIA        GO');
// R da entrada: multa 2% a partir de 11/12
confere(r1, 8, 17, '300003R 01'); confere(r1, 66, 89, '2' + '11122026' + '000000000000200');
// S da entrada
confere(s1, 8, 18, '300004S 013'); confere(s1, 19, 58, 'NAO RECEBER APOS 30 DIAS'.padEnd(40));
// Baixa
confere(p2, 8, 17, '300005P 02'); confere(p2, 38, 47, '0000000210'); confere(q2, 8, 17, '300006Q 02');
// Trailers: 10 registros no lote (8 + 2), 2 títulos, R$ 1.700,50; 12 registros no arquivo
confere(tl, 1, 46, '75600015' + ' '.repeat(9) + '000010' + '000002' + '00000000000170050');
confere(ta, 1, 29, '75699999' + ' '.repeat(9) + '000001' + '000012');
assert.throws(() => sicoob.cnab240.remessa(conta, 1, [{ comando: 'alterar_valor', boleto, dados: { valor: 10 } }], new Date()), /alteração de valor/);
ok('remessa: 12 linhas de 240, header/lote/P/Q/R/S/trailers nas posições do ACBr; alterar_valor recusado');

// ---------------------------------------------------------------------------
// 3) Retorno CNAB 240 sintético (T + U): liquidação com tarifa e rejeição
// ---------------------------------------------------------------------------
function montar(campos: Record<number, string>): string {
  let l = ' '.repeat(240);
  for (const [de, t] of Object.entries(campos)) l = l.slice(0, Number(de) - 1) + t + l.slice(Number(de) - 1 + t.length);
  assert.equal(l.length, 240);
  return l;
}
const arquivoRetorno = [
  montar({ 1: '75600000', 18: '212345678000195', 53: '03009', 58: '0', 59: '000000123456', 71: '7', 143: '209112026', 158: '000045', 164: '081' }),
  montar({ 1: '75600011T01', 14: '040' }),
  // Liquidação: tarifa R$ 2,50 (T 199-213), motivo 04 = compensação eletrônica
  montar({ 1: '75600013', 9: '00001', 14: 'T', 16: '06', 18: '30090', 38: '0059311516', 48: '01014', 58: '1', 59: 'NF123',
    74: '10122026', 82: '000000000150050', 106: 'NF123', 199: '000000000000250', 214: '04' }),
  // U: juros + multa R$ 35,00, pago R$ 1.535,50, ocorrência 15/12, crédito 16/12
  montar({ 1: '75600013', 9: '00002', 14: 'U', 16: '06', 18: '000000000003500', 33: '000000000000000', 48: '000000000000000',
    63: '000000000000000', 78: '000000000153550', 93: '000000000153300', 138: '15122026', 146: '16122026' }),
  // Rejeição: motivos 08 (nosso número inválido) e 16 (vencimento inválido)
  montar({ 1: '75600013', 9: '00003', 14: 'T', 16: '03', 38: '0000000210', 58: '1', 59: 'NF124', 82: '000000000020000', 214: '0816' }),
  montar({ 1: '75600013', 9: '00004', 14: 'U', 16: '03', 138: '09112026' }),
  montar({ 1: '75600015', 18: '000006' }),
  montar({ 1: '75699999', 18: '000001000008' }),
].join('\r\n');

const ret = sicoob.cnab240.retorno(arquivoRetorno, conta);
assert.equal(ret.numero, 45);
assert.equal(ret.dataArquivo, '2026-11-09');
assert.equal(ret.ocorrencias.length, 2);
const [liq, rej] = ret.ocorrencias;
assert.equal(liq.nossoNumero, sicoob.nossoNumero(conta, 5931151).numero); // mesmo formato: 7 dígitos, sem DV
assert.deepEqual(
  { tipo: liq.tipo, cod: liq.codigoBanco, seu: liq.seuNumero, titulo: liq.valorTitulo, pago: liq.valorPago, juros: liq.valorJuros, tarifa: liq.valorTarifa, oc: liq.dataOcorrencia, cred: liq.dataCredito },
  { tipo: 'liquidacao', cod: '06', seu: 'NF123', titulo: 1500.5, pago: 1535.5, juros: 35, tarifa: 2.5, oc: '2026-12-15', cred: '2026-12-16' },
);
assert.match(liq.motivo, /Liquidação normal: 04 - Compensação eletrônica/);
assert.equal(rej.nossoNumero, '0000021');
assert.equal(rej.tipo, 'rejeicao');
assert.match(rej.motivo, /08 - Nosso número inválido; 16 - Data de vencimento inválida/);
assert.equal(rej.dataOcorrencia, '2026-11-09');
assert.throws(() => sicoob.cnab240.retorno(arquivoRetorno, { ...conta, conta: '999' }), /não é desta conta/);
ok(`retorno: NSA 45, liquidação ${liq.nossoNumero} pago 1535,50 tarifa 2,50; rejeição ${rej.nossoNumero} "${rej.motivo}"`);

// ---------------------------------------------------------------------------
// 4) API v3 com um ClienteApi falso
// ---------------------------------------------------------------------------
type Pedido = Parameters<ClienteApi['pedir']>[0];
function clienteFalso(responder: (p: Pedido) => Partial<RespostaHttp>) {
  const pedidos: Pedido[] = [];
  const tokens: Parameters<ClienteApi['oauth']>[0][] = [];
  const cli: ClienteApi = {
    credenciais: { clientId: 'cid-123', clientSecret: '', chaveAplicacao: '' },
    async oauth(o) { tokens.push(o); return 'tok-prod'; },
    async pedir(p) { pedidos.push(p); const r = responder(p); return { status: 200, corpo: null, texto: '', ...r }; },
  };
  return { cli, pedidos, tokens };
}

const barras = codigoBarras('756', boleto.dataVencimento, boleto.valor, campo);
const linha = linhaDigitavel(barras);
const sandbox = clienteFalso(() => ({ status: 200, corpo: { resultado: { nossoNumero: 59311516, codigoBarras: barras, linhaDigitavel: linha, qrCode: '00020101021226...6304ABCD' } } }));
const reg = await sicoob.api.registrar(sandbox.cli, conta, boleto);
const enviado = sandbox.pedidos[0];
assert.equal(enviado.metodo, 'POST');
assert.equal(enviado.url, 'https://sandbox.sicoob.com.br/sicoob/sandbox/cobranca-bancaria/v3/boletos');
assert.deepEqual(enviado.cabecalhos, { Authorization: 'Bearer 1301865f-c6bc-38f3-9f49-666dbcfc59c3', client_id: 'cid-123' });
assert.equal(sandbox.tokens.length, 0); // sandbox usa o token fixo do ACBr
assert.deepEqual(enviado.corpo, {
  numeroCliente: 136352, codigoModalidade: 1, numeroContaCorrente: 1234567, codigoEspecieDocumento: 'DM', dataEmissao: '2026-11-08',
  nossoNumero: 59311516, seuNumero: 'NF123', identificacaoBoletoEmpresa: 'NF123', identificacaoEmissaoBoleto: 2, identificacaoDistribuicaoBoleto: 2,
  valor: 1500.5, dataVencimento: '2026-12-10', numeroParcela: 1, aceite: false,
  codigoProtesto: 1, numeroDiasProtesto: 30,
  tipoDesconto: 1, dataPrimeiroDesconto: '2026-12-05', valorPrimeiroDesconto: 10,
  tipoJurosMora: 2, dataJurosMora: '2026-12-11', valorJurosMora: 1,
  tipoMulta: 2, dataMulta: '2026-12-11', valorMulta: 2,
  pagador: { numeroCpfCnpj: '12345678909', nome: 'José da Silva', endereco: 'Rua das Flores 100', bairro: 'Centro', cidade: 'Goiânia', cep: '74000100', uf: 'GO', email: 'jose@exemplo.com' },
  mensagensInstrucao: ['Não receber após 30 dias'],
  gerarPdf: false, codigoCadastrarPIX: 1,
});
assert.deepEqual(reg, { nossoNumero: '5931151', nossoNumeroDv: '6', codigoBarras: barras, linhaDigitavel: linha, pixEmv: '00020101021226...6304ABCD' });
ok(`registrar: JSON ${JSON.stringify(enviado.corpo).length} bytes conferido; devolveu linha ${linha} e QR Code`);

// Produção: token pelo OAuth (client_id no form, sem secret) e erro do banco em português
const producao = clienteFalso(() => ({ status: 400, corpo: { mensagens: [{ codigo: '4001', mensagem: 'Nosso número já cadastrado' }] } }));
await assert.rejects(sicoob.api.registrar(producao.cli, { ...conta, ambiente: 1 }, boleto), /O Sicoob recusou o registro do boleto \(HTTP 400\): 4001 - Nosso número já cadastrado/);
assert.equal(producao.pedidos[0].url, 'https://api.sicoob.com.br/cobranca-bancaria/v3/boletos');
assert.equal(producao.tokens[0].url, 'https://auth.sicoob.com.br/auth/realms/cooperado/protocol/openid-connect/token');
assert.equal(producao.tokens[0].autenticacao, 'corpo');
assert.equal(producao.pedidos[0].cabecalhos?.Authorization, 'Bearer tok-prod');
ok('produção: OAuth com client_id e erro "4001 - Nosso número já cadastrado" virou Error');

// Consulta: 204 = não registrado
const vazio = clienteFalso(() => ({ status: 204 }));
assert.deepEqual(await sicoob.api.consultar(vazio.cli, conta, boleto), { registrado: false });
assert.equal(vazio.pedidos[0].url, 'https://sandbox.sicoob.com.br/sicoob/sandbox/cobranca-bancaria/v3/boletos?numeroCliente=136352&codigoModalidade=1&nossoNumero=59311516');

// Instruções
const instr = clienteFalso(() => ({ status: 204 }));
await sicoob.api.instruir(instr.cli, conta, boleto, 'baixar');
await sicoob.api.instruir(instr.cli, conta, boleto, 'alterar_vencimento', { vencimento: '2027-01-10' });
assert.deepEqual([instr.pedidos[0].metodo, instr.pedidos[0].url.split('/v3')[1], instr.pedidos[0].corpo], ['POST', '/boletos/59311516/baixar', { numeroCliente: 136352, codigoModalidade: 1 }]);
assert.deepEqual([instr.pedidos[1].metodo, instr.pedidos[1].url.split('/v3')[1], instr.pedidos[1].corpo],
  ['PATCH', '/boletos/59311516', { numeroCliente: 136352, codigoModalidade: 1, prorrogacaoVencimento: { dataVencimento: '2027-01-10' } }]);
await assert.rejects(sicoob.api.instruir(instr.cli, conta, boleto, 'alterar_valor', { valor: 1 }), /alteração de valor/);
ok('consulta 204 -> não registrado; baixa (POST /baixar) e prorrogação (PATCH) conferidas');

// Movimento: solicita -> situação -> download (ZIP para liquidações, gzip para baixas)
function zip(nome: string, conteudo: string): string {
  const dados = deflateRawSync(Buffer.from(conteudo));
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8);
  h.writeUInt32LE(dados.length, 18); h.writeUInt32LE(Buffer.byteLength(conteudo), 22); h.writeUInt16LE(nome.length, 26);
  return Buffer.concat([h, Buffer.from(nome), dados, Buffer.from('PK\x01\x02 diretório central')]).toString('base64');
}
const liquidacoes = [{ numeroTitulo: 59311516, seuNumero: 'NF123', codigoBarras: barras, valorTitulo: 1500.5, valorLiquido: 1535.5, valorMora: 35,
  valorTarifaMovimento: 2.5, valorDesconto: 0, valorAbatimento: 0, dataLiquidacao: '2026-11-01T10:00:00', dataPrevisaoCredito: '2026-11-03', siglaMovimento: 'LIQUI', tipoOpFinanceira: 7 }];
const baixas = [{ numeroTitulo: 210, seuNumero: 'NF124', valorTitulo: 200, dataLiquidacao: '2026-11-02', siglaMovimento: 'BAIX' }];
const mov = clienteFalso((p) => {
  if (p.metodo === 'POST') return { corpo: { resultado: { codigoSolicitacao: (p.corpo as any).tipoMovimento === 5 ? 777 : 778 } } };
  if (p.url.includes('/download')) {
    const arq = p.url.includes('codigoSolicitacao=777') ? zip('mov.json', JSON.stringify(liquidacoes)) : gzipSync(JSON.stringify(baixas)).toString('base64');
    return { corpo: { resultado: { arquivo: arq } } };
  }
  return { corpo: { resultado: { mensagem: 'ok', quantidadeArquivo: 1, idArquivos: [1] } } };
});
const ocs = await sicoob.api.movimento(mov.cli, conta, '2026-11-01', '2026-11-02');
assert.deepEqual(mov.pedidos.filter((p) => p.metodo === 'POST').map((p) => p.corpo),
  [5, 6].map((t) => ({ numeroCliente: 136352, tipoMovimento: t, dataInicial: '2026-11-01', dataFinal: '2026-11-02' })));
assert.deepEqual(ocs.map((o) => [o.tipo, o.nossoNumero, o.valorPago, o.valorTarifa, o.dataOcorrencia, o.dataCredito]), [
  ['liquidacao', '5931151', 1535.5, 2.5, '2026-11-01', '2026-11-03'],
  ['baixa', '0000021', 0, 0, '2026-11-02', undefined],
]);
// Período de 5 dias vira 3 janelas de até 2 dias (x 2 tipos); período sem registros devolve vazio
const semNada = clienteFalso((p) => (p.metodo === 'POST' ? { corpo: { resultado: { codigoSolicitacao: 1 } } } : { corpo: { resultado: { quantidadeTotalRegistros: 0 } } }));
assert.deepEqual(await sicoob.api.movimento(semNada.cli, conta, '2026-11-01', '2026-11-05'), []);
assert.deepEqual(semNada.pedidos.filter((p) => p.metodo === 'POST').map((p: any) => `${p.corpo.dataInicial}..${p.corpo.dataFinal}`),
  ['2026-11-01..2026-11-02', '2026-11-01..2026-11-02', '2026-11-03..2026-11-04', '2026-11-03..2026-11-04', '2026-11-05..2026-11-05', '2026-11-05..2026-11-05']);
ok('movimento: solicitação/situação/download, ZIP e gzip lidos, janelas de 2 dias');

console.log('\nSicoob: tudo conferido.');

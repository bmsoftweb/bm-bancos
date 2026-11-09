/**
 * Teste do módulo do Banco do Brasil, sem rede e sem banco de dados:
 *   npx tsx server/bancos/bb.teste.ts
 */
import assert from 'node:assert/strict';
import { limparTexto, pos } from '../boleto/cnab.js';
import { codigoBarras, linhaDigitavel } from '../boleto/febraban.js';
import type { Boleto, ClienteApi, Conta, RespostaHttp } from '../boleto/tipos.js';
import { bb } from './bb.js';

const ok = (msg: string) => console.log(`  ok  ${msg}`);

const conta: Conta = {
  id: 1, empresaId: 1, bancoCodigo: '001',
  agencia: '2145', agenciaDv: '1', conta: '545144', contaDv: '2',
  beneficiario: '', beneficiarioDv: '', convenio: '2354187', carteira: '17',
  layoutCnab: '240', canal: 'remessa', ambiente: 1,
  config: { variacao: '019' },
  empresa: {
    cnpj: '18760540000139', razaoSocial: 'Nome do Cedente Completo', logradouro: 'Rua São Pedro', numero: '124',
    complemento: '', bairro: 'Centro', cidade: 'Tatuí', uf: 'SP', cep: '18460000',
  },
};

// ---------------------------------------------------------------------------
console.log('(1) nosso número, campo livre, código de barras e linha digitável');
// ---------------------------------------------------------------------------
assert.deepEqual(bb.validarConta(conta), []);
assert.match(bb.validarConta({ ...conta, convenio: '12345' }).join(' '), /4, 6 ou 7 dígitos/);
assert.match(bb.validarConta({ ...conta, convenio: '123456', canal: 'api' }).join(' '), /só atende convênio de 7 dígitos/);
assert.match(bb.validarConta({ ...conta, config: {} }).join(' '), /Variação da carteira/);
assert.match(bb.validarConta({ ...conta, agencia: '21451', contaDv: '' }).join(' '), /Agência.*DV da conta/);
ok('validarConta aceita a conta de 7 dígitos e recusa convênio de 5, API com 6, sem variação, agência e DV errados');

const nn = bb.nossoNumero(conta, 1);
assert.deepEqual(nn, { numero: '23541870000000001', dv: '' });
assert.throws(() => bb.nossoNumero(conta, 12_345_678_901), /não cabe em 10 posições/);
assert.equal(bb.nossoNumeroImpresso(conta, nn.numero, nn.dv), '23541870000000001');
ok('convênio 7: nosso número = 2354187 + 0000000001, sem DV; sequencial de 11 dígitos dá erro');

// À mão: "000000" + "23541870000000001" + carteira "17"
const campo = bb.campoLivre(conta, nn.numero, nn.dv);
assert.equal(campo, '0000002354187000000000117');
// Vencimento 10/12/2026: 10.656 dias desde 07/10/1997 -> fator (10656 - 10000) % 9000 + 1000 = 1656.
// 001 9 1656 0000015000 + campo livre: soma módulo 11 (pesos 2..9) = 420, resto 2, DV 11 - 2 = 9.
const barras = codigoBarras('001', '2026-12-10', 150, campo);
assert.equal(barras, '00199165600000150000000002354187000000000117');
// Campos: 001900000 (DV 9), 0235418700 (DV 3), 0000000117 (DV 2), DV geral 9, fator+valor
assert.equal(linhaDigitavel(barras), '00190000090235418700300000001172916560000015000');
ok(`campo livre ${campo}, barras ${barras}`);

assert.equal(bb.agenciaCodigoBeneficiario(conta), '2145-1/545144-2');
assert.equal(bb.carteiraImpressa(conta), '17/019');
ok('agência/código do beneficiário "2145-1/545144-2" e carteira "17/019"');

// DV dos convênios de 4 e 6 dígitos: casos do teste do ACBr (CalcularDigitoVerificador_BancoBrasil*)
assert.equal(bb.nossoNumero({ ...conta, convenio: '1233' }, 1234567).dv, 'X');
assert.equal(bb.nossoNumero({ ...conta, convenio: '0185' }, 8547125).dv, '0');
assert.equal(bb.nossoNumero({ ...conta, convenio: '012345' }, 12345).dv, '3');
assert.throws(() => bb.nossoNumero({ ...conta, convenio: '012345' }, 123456), /não cabe em 5 posições/);
const conta4 = { ...conta, convenio: '1234' };
const nn4 = bb.nossoNumero(conta4, 123);
assert.deepEqual(nn4, { numero: '12340000123', dv: '9' });
assert.equal(bb.nossoNumeroImpresso(conta4, nn4.numero, nn4.dv), '12340000123-9');
// Nosso número(11) + agência(4) + conta(8) + carteira(2)
assert.equal(bb.campoLivre(conta4, nn4.numero, nn4.dv), '12340000123' + '2145' + '00545144' + '17');
ok('convênios de 4 e 6: DV X/0/3 iguais aos do ACBr; campo livre 12340000123 2145 00545144 17');

// ---------------------------------------------------------------------------
console.log('(2) remessa CNAB 240 com uma entrada e uma baixa');
// ---------------------------------------------------------------------------
// Primeiras linhas do RemessaBB240Valido.rem do ACBr (Testes/FPCUnit/ACBrBoleto/Remessa), título 1
const VALIDO = {
  headerArquivo: '00100000         218760540000139002354187001415019  0214510000005451442 NOME DO CEDENTE COMPLETO      BANCO DO BRASIL                         12911201900000000000103000000                    00000000000000000000           CSP000            ',
  headerLote: '00100011R0100020 2018760540000139002354187001415019  0214510000005451442 Nome do Cedente Completo                                                                                      000000012911201900000000                                 ',
  P: '0010001300001P 010214510000005451442 23541870000000001   71222100000         1008201700000000001817200000 02A10072017115082017000000000000020109082017000000000000230000000000000000000000000000110                         1100000090000000000 ',
  Q: '0010001300002Q 011000012345678901Jose da Silva 1                         Rua da Esperança 100                    Centro         18270000Tatui          SP1000099999999999xxxxxxxx                                000                            ',
  R: '0010001300003R 01000000000000000000000000000000000000000000000000211082017000000000000500          Teste Mensagem 1                                                                                    00000000000000000000000000000000         ',
};

const contaExemplo: Conta = { ...conta, carteira: '15' }; // o exemplo do ACBr usa carteira 15
const pagador = { documento: '12345678901', nome: 'Jose da Silva 1', logradouro: 'Rua da Esperança', numero: '100', bairro: 'Centro', cidade: 'Tatui', uf: 'SP', cep: '18270000' };
const entrada: Boleto = {
  nossoNumero: '23541870000000001', nossoNumeroDv: '', seuNumero: '100000',
  dataEmissao: '2017-07-10', dataVencimento: '2017-08-10', valor: 181.72, pagador, especie: 'DM', aceite: 'A',
  multa: { percentual: 5, data: '2017-08-11' },
  juros: { percentualMensal: 1, data: '2017-08-15' },
  desconto: { valor: 2.3, data: '2017-08-09' },
  abatimento: 1.1, diasProtesto: 10,
  mensagens: ['Teste Mensagem 1', 'Teste Mensagem 2'],
};
const baixa: Boleto = { ...entrada, nossoNumero: '23541870000000002', seuNumero: '200000', multa: undefined, juros: undefined, desconto: undefined, abatimento: undefined, diasProtesto: undefined };

const rem = bb.cnab240.remessa(contaExemplo, 1, [{ comando: 'registrar', boleto: entrada }, { comando: 'baixar', boleto: baixa }], new Date(2026, 10, 8, 14, 30, 5));
assert.ok(rem.endsWith('\r\n'));
const L = rem.slice(0, -2).split('\r\n');
assert.deepEqual(L.map((l) => l.length), Array(L.length).fill(240));
assert.deepEqual(L.map((l) => pos(l, 8, 8) + (pos(l, 8, 8) === '3' ? pos(l, 14, 14) : '')), ['0', '1', '3P', '3Q', '3R', '3P', '3Q', '5', '9']);
ok(`${L.length} linhas de 240 posições, CRLF no fim: header, lote, P Q R (entrada com multa), P Q (baixa), trailers`);

const [hA, hL, pE, qE, rE, pB, qB, tL, tA] = L;
const campos: [string, string, number, number, string][] = [
  ['header arquivo', hA, 144, 151, '08112026'], ['header arquivo', hA, 152, 157, '143005'], ['header arquivo', hA, 158, 163, '000001'],
  ['header lote', hL, 52, 53, '  '], ['header lote', hL, 184, 191, '00000001'],
  ['P entrada', pE, 9, 13, '00001'], ['P entrada', pE, 16, 17, '01'], ['P entrada', pE, 38, 57, '23541870000000001   '],
  ['P entrada', pE, 78, 85, '10082017'], ['P entrada', pE, 86, 100, '000000000018172'],
  ['P entrada', pE, 118, 141, '2' + '15082017' + '000000000000100'], // juros 1% ao mês (taxa mensal) a partir de 15/08
  ['P entrada', pE, 142, 165, '1' + '09082017' + '000000000000230'], ['P entrada', pE, 181, 195, '000000000000110'],
  ['P entrada', pE, 196, 220, '100000'.padEnd(25)], ['P entrada', pE, 221, 227, '110' + '0' + '000'],
  ['R entrada', rE, 66, 89, '2' + '11082017' + '000000000000500'],
  ['P baixa', pB, 9, 13, '00004'], ['P baixa', pB, 16, 17, '02'], ['P baixa', pB, 38, 57, '23541870000000002   '], ['P baixa', pB, 225, 227, '   '],
  ['Q baixa', qB, 9, 13, '00005'], ['Q baixa', qB, 16, 17, '02'],
  ['trailer lote', tL, 18, 23, '000007'], ['trailer arquivo', tA, 18, 29, '000001' + '000009'],
];
for (const [nome, l, de, ate, esperado] of campos) assert.equal(pos(l, de, ate), esperado, `${nome} ${de}-${ate}`);
ok(`${campos.length} campos-chave nas posições do manual (datas, NSA, movimentos 01/02, nosso número, valores, juros, desconto, protesto, multa, quantidades)`);

/**
 * Compara com o arquivo válido do ACBr posição a posição (texto normalizado em
 * maiúsculas sem acento), menos as faixas que mudam por motivo conhecido.
 */
function comparar(nome: string, gerada: string, valida: string, ignorar: [number, number][]) {
  const v = limparTexto(valida);
  let conferidas = 0;
  for (let i = 1; i <= 240; i++) {
    if (ignorar.some(([de, ate]) => i >= de && i <= ate)) continue;
    assert.equal(gerada[i - 1], v[i - 1], `${nome}, posição ${i}: gerado "${pos(gerada, i, i)}", exemplo "${pos(v, i, i)}"\n${gerada}\n${v}`);
    conferidas++;
  }
  ok(`${nome}: ${conferidas} posições iguais ao RemessaBB240Valido.rem${ignorar.length ? ` (fora ${ignorar.map(([a, b]) => (a === b ? a : `${a}-${b}`)).join(', ')})` : ''}`);
}
comparar('header de arquivo', hA, VALIDO.headerArquivo, [[144, 157]]); // data e hora de geração
// 12-13: o ACBr atual grava brancos (FEBRABAN: uso exclusivo), o exemplo antigo tinha "00"; 192-199: data
comparar('header de lote', hL, VALIDO.headerLote, [[12, 13], [192, 199]]);
// 60: tipo de documento (o teste do ACBr configurou Escritural; o padrão é Tradicional = 1)
// 118 e 127-141: juros (aqui taxa mensal; no exemplo, valor por dia); 196-220: o exemplo não tinha seu número
comparar('segmento P', pE, VALIDO.P, [[60, 60], [118, 118], [127, 141], [196, 220]]);
comparar('segmento Q', qE, VALIDO.Q, [[154, 209]]); // sacador/avalista: o exemplo tem, o Boleto do BMBancos não
comparar('segmento R', rE, VALIDO.R, []);

assert.throws(() => bb.cnab240.remessa(contaExemplo, 2, [{ comando: 'alterar_valor', boleto: baixa, dados: { valor: 10 } }], new Date()), /use a API/);
ok('alterar_valor pela remessa é recusado com mensagem clara');

// ---------------------------------------------------------------------------
console.log('(3) retorno CNAB 240 sintético (T + U)');
// ---------------------------------------------------------------------------
/** Linha de 240 brancos com cada valor na posição do manual (base 1) */
function montar(campos: Record<number, string>): string {
  const l = Array(240).fill(' ');
  for (const [de, v] of Object.entries(campos)) [...v].forEach((c, i) => (l[Number(de) - 1 + i] = c));
  return l.join('');
}
const det = (seq: number, seg: string, cod: string, resto: Record<number, string>) =>
  montar({ 1: '001', 4: '0001', 8: '3', 9: String(seq).padStart(5, '0'), 14: seg, 16: cod, ...resto });

const ret = [
  montar({ 1: '001', 4: '0000', 8: '0', 18: '2', 19: '18760540000139', 33: '002354187', 143: '2', 144: '07112026', 152: '101500', 158: '000123' }),
  montar({ 1: '001', 4: '0001', 8: '1', 9: 'T', 10: '01' }),
  // Liquidação: título 150,00, pago 153,00 (3,00 de juros + multa), tarifa 2,50, motivo 03
  det(1, 'T', '06', { 38: '23541870000000001', 58: '7', 59: '100000', 74: '10122026', 82: '000000000015000', 106: '100000', 199: '000000000000250', 214: '03' }),
  det(2, 'U', '06', { 18: '000000000000300', 33: '0'.repeat(15), 48: '0'.repeat(15), 78: '000000000015300', 93: '000000000015050', 138: '05112026', 146: '06112026' }),
  // Entrada rejeitada: motivos 08 (nosso número inválido) e 16 (vencimento inválido)
  det(3, 'T', '03', { 38: '23541870000000002', 59: '200000', 82: '000000000020000', 214: '0816' }),
  det(4, 'U', '03', { 18: '0'.repeat(15), 78: '0'.repeat(15), 138: '05112026', 146: '00000000' }),
  montar({ 1: '001', 4: '0001', 8: '5', 18: '000006' }),
  montar({ 1: '001', 4: '9999', 8: '9', 18: '000001', 24: '000008' }),
].join('\r\n');

const r = bb.cnab240.retorno(ret, conta);
assert.equal(r.numero, 123);
assert.equal(r.dataArquivo, '2026-11-07');
assert.equal(r.ocorrencias.length, 2);
const [liq, rej] = r.ocorrencias;
assert.equal(liq.nossoNumero, bb.nossoNumero(conta, 1).numero);
assert.deepEqual(
  { ...liq, motivo: undefined },
  {
    nossoNumero: '23541870000000001', seuNumero: '100000', tipo: 'liquidacao', codigoBanco: '06', motivo: undefined,
    dataOcorrencia: '2026-11-05', dataCredito: '2026-11-06', valorTitulo: 150, valorPago: 153, valorJuros: 3,
    valorDesconto: undefined, valorAbatimento: undefined, valorTarifa: 2.5,
  },
);
assert.equal(liq.motivo, '06 Liquidação: 03-No próprio banco');
ok(`liquidação: nosso número igual ao de nossoNumero(), pago 153,00, juros 3,00, tarifa 2,50, ocorrência 05/11, crédito 06/11 ("${liq.motivo}")`);
assert.equal(rej.tipo, 'rejeicao');
assert.equal(rej.nossoNumero, '23541870000000002');
assert.equal(rej.motivo, '03 Entrada rejeitada: 08-Nosso número inválido; 16-Data de vencimento inválida');
assert.equal(rej.valorPago, undefined);
ok(`rejeição: "${rej.motivo}"`);
ok('header: NSA 123 e data do arquivo 2026-11-07');
assert.throws(() => bb.cnab240.retorno(rem, conta), /remessa, não um retorno/);
assert.throws(() => bb.cnab240.retorno(ret, { ...conta, empresa: { ...conta.empresa, cnpj: '11222333000181' } }), /outro beneficiário/);
ok('recusa arquivo de remessa e retorno de outro CNPJ');

// ---------------------------------------------------------------------------
console.log('(4) API Cobrança v2 com ClienteApi falso');
// ---------------------------------------------------------------------------
function clienteFalso(respostas: Partial<RespostaHttp>[]) {
  const pedidos: Parameters<ClienteApi['pedir']>[0][] = [];
  const tokens: Parameters<ClienteApi['oauth']>[0][] = [];
  const cli: ClienteApi = {
    credenciais: { clientId: 'id', clientSecret: 'segredo', chaveAplicacao: 'CHAVE' },
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

const contaApi: Conta = { ...conta, canal: 'api', ambiente: 2 };
const boletoApi: Boleto = {
  nossoNumero: '23541870000000001', nossoNumeroDv: '', seuNumero: 'NF-123/1',
  dataEmissao: '2026-11-08', dataVencimento: '2026-12-10', valor: 150,
  pagador: { documento: '11222333000181', nome: 'Empresa Pagadora Ltda', logradouro: 'Av. Brasil', numero: '500', complemento: 'Sala 2', bairro: 'Centro', cidade: 'Tatuí', uf: 'SP', cep: '18270000' },
  especie: 'DM', aceite: 'N',
  multa: { percentual: 2, data: '2026-12-11' },
  juros: { percentualMensal: 1, data: '2026-12-11' },
  desconto: { valor: 5, data: '2026-12-05' },
  diasProtesto: 10, diasBaixa: 30,
  mensagens: ['Referente à NF 123', 'Não receber após 30 dias'],
  pixHibrido: true,
};

const f = clienteFalso([{
  status: 201,
  corpo: {
    numero: '00023541870000000001',
    linhaDigitavel: '00190000090235418700300000001172916560000015000',
    codigoBarraNumerico: '00199165600000150000000002354187000000000117',
    qrCode: { url: 'qrcodepix.bb.com.br/x', txId: 'BOLETO123', emv: '00020101021226870014br.gov.bcb.pix' },
  },
}]);
const res = await bb.api.registrar(f.cli, contaApi, boletoApi);
assert.deepEqual(f.tokens, [{ url: 'https://oauth.hm.bb.com.br/oauth/token', escopo: 'cobrancas.boletos-info cobrancas.boletos-requisicao', autenticacao: 'basic' }]);
const p0 = f.pedidos[0];
assert.equal(p0.metodo, 'POST');
assert.equal(p0.url, 'https://api.hm.bb.com.br/cobrancas/v2/boletos?gw-dev-app-key=CHAVE');
assert.deepEqual(p0.cabecalhos, { Authorization: 'Bearer TOKEN' });
assert.deepEqual(p0.corpo, {
  numeroConvenio: 2354187,
  numeroCarteira: 17,
  numeroVariacaoCarteira: 19,
  codigoModalidade: 1,
  dataEmissao: '08.11.2026',
  dataVencimento: '10.12.2026',
  valorOriginal: 150,
  valorAbatimento: 0,
  quantidadeDiasProtesto: 10,
  indicadorAceiteTituloVencido: 'S',
  numeroDiasLimiteRecebimento: 30,
  codigoAceite: 'N',
  codigoTipoTitulo: 2,
  descricaoTipoTitulo: 'DM',
  indicadorPermissaoRecebimentoParcial: 'N',
  campoUtilizacaoBeneficiario: 'NF-1231',
  numeroTituloBeneficiario: 'NF-123/1',
  numeroTituloCliente: '00023541870000000001',
  mensagemBloquetoOcorrencia: 'REFERENTE À NF 123 NÃO RECEBER',
  desconto: { tipo: 1, dataExpiracao: '05.12.2026', valor: 5 },
  jurosMora: { tipo: 2, porcentagem: 1 },
  multa: { tipo: 2, data: '11.12.2026', porcentagem: 2 },
  pagador: { tipoInscricao: 2, numeroInscricao: '11222333000181', nome: 'Empresa Pagadora Ltda', endereco: 'Av. Brasil 500', cep: 18270000, cidade: 'Tatuí', bairro: 'Centro', uf: 'SP' },
  indicadorPix: 'S',
});
ok('POST /boletos em homologação: OAuth basic com escopo, gw-dev-app-key, numeroTituloCliente 000+17, indicadorPix S, datas DD.MM.AAAA');
assert.deepEqual(res, {
  nossoNumero: '23541870000000001', nossoNumeroDv: '',
  codigoBarras: '00199165600000150000000002354187000000000117',
  linhaDigitavel: '00190000090235418700300000001172916560000015000',
  pixEmv: '00020101021226870014br.gov.bcb.pix',
});
ok('resposta do registro: linha digitável, código de barras e qrCode.emv');

const fErro = clienteFalso([{ status: 400, corpo: { erros: [{ codigo: '4874915', versao: '1', mensagem: 'Nosso Número já incluído anteriormente.', ocorrencia: 'CBR0001' }] } }]);
await assert.rejects(bb.api.registrar(fErro.cli, contaApi, boletoApi), /registro do boleto falhou \(HTTP 400\): Nosso Número já incluído anteriormente\. \(código 4874915\)/);
await assert.rejects(bb.api.registrar(clienteFalso([{ status: 503, texto: '' }]).cli, contaApi, boletoApi), /HTTP 503\): serviço do Banco do Brasil indisponível/);
await assert.rejects(bb.api.registrar(clienteFalso([]).cli, contaApi, { ...boletoApi, diasProtesto: 30 }), /6 a 29, 35, 40 ou 45/);
ok('erros do BB viram Error legível (erros[].mensagem com código, 503 sem corpo, prazo de protesto inválido)');

const fConsulta = clienteFalso([{ status: 404, corpo: null, texto: '' }]);
assert.deepEqual(await bb.api.consultar(fConsulta.cli, contaApi, boletoApi), { registrado: false });
assert.equal(fConsulta.pedidos[0].url, 'https://api.hm.bb.com.br/cobrancas/v2/boletos/00023541870000000001?gw-dev-app-key=CHAVE&numeroConvenio=2354187');
const naoExiste = { erros: [{ codigo: '4678420', mensagem: 'Título não encontrado para o nosso número informado.' }] };
assert.deepEqual(await bb.api.consultar(clienteFalso([{ status: 400, corpo: naoExiste, texto: JSON.stringify(naoExiste) }]).cli, contaApi, boletoApi), { registrado: false });
const achado = await bb.api.consultar(clienteFalso([{ status: 200, corpo: { codigoLinhaDigitavel: '00190000090235418700300000001172916560000015000', textoCodigoBarrasTituloCobranca: '00199165600000150000000002354187000000000117', codigoEstadoTituloCobranca: 1 } }]).cli, contaApi, boletoApi);
assert.equal(achado.registrado, true);
assert.equal(achado.resultado?.codigoBarras, '00199165600000150000000002354187000000000117');
ok('consultar: 404 e 400 "não encontrado" = { registrado: false }; 200 devolve os códigos');

const fInst = clienteFalso([{ status: 200 }, { status: 200 }]);
await bb.api.instruir(fInst.cli, contaApi, boletoApi, 'baixar');
await bb.api.instruir(fInst.cli, contaApi, boletoApi, 'alterar_vencimento', { vencimento: '2026-12-20' });
assert.deepEqual(
  fInst.pedidos.map((p) => [p.metodo, p.url.replace('https://api.hm.bb.com.br/cobrancas/v2', ''), p.corpo]),
  [
    ['POST', '/boletos/00023541870000000001/baixar?gw-dev-app-key=CHAVE', { numeroConvenio: 2354187 }],
    ['PATCH', '/boletos/00023541870000000001?gw-dev-app-key=CHAVE', { numeroConvenio: 2354187, indicadorNovaDataVencimento: 'S', alteracaoData: { novaDataVencimento: '20.12.2026' } }],
  ],
);
ok('instruir: POST .../baixar e PATCH com indicadorNovaDataVencimento');

const fMov = clienteFalso([
  {
    status: 200,
    corpo: {
      indicadorContinuidade: 'S', proximoIndice: 300,
      boletos: [
        { numeroBoletoBB: '00023541870000000001', codigoEstadoTituloCobranca: 6, estadoTituloCobranca: 'LIQUIDADO', dataMovimento: '05.11.2026', dataCredito: '06.11.2026', valorOriginal: 150, valorPago: 153 },
        { numeroBoletoBB: '00023541870000000003', codigoEstadoTituloCobranca: 1, estadoTituloCobranca: 'NORMAL', dataMovimento: '05.11.2026', valorOriginal: 90 },
        { numeroBoletoBB: '00099999990000000001', codigoEstadoTituloCobranca: 6, estadoTituloCobranca: 'LIQUIDADO', dataMovimento: '05.11.2026', valorPago: 10 },
      ],
    },
  },
  { status: 200, corpo: { indicadorContinuidade: 'N', boletos: [{ numeroBoletoBB: '00023541870000000004', codigoEstadoTituloCobranca: 7, estadoTituloCobranca: 'BAIXADO', dataMovimento: '06.11.2026', valorOriginal: 80, valorPago: 0 }] } },
]);
const mov = await bb.api.movimento(fMov.cli, contaApi, '2026-11-01', '2026-11-08');
assert.equal(fMov.pedidos.length, 2);
assert.equal(fMov.pedidos[0].url, 'https://api.hm.bb.com.br/cobrancas/v2/boletos?gw-dev-app-key=CHAVE&indicadorSituacao=B&agenciaBeneficiario=2145&contaBeneficiario=545144&dataInicioMovimento=01.11.2026&dataFimMovimento=08.11.2026');
assert.match(fMov.pedidos[1].url, /&indice=300$/);
assert.deepEqual(mov, [
  { nossoNumero: '23541870000000001', tipo: 'liquidacao', codigoBanco: '6', motivo: '6 LIQUIDADO', dataOcorrencia: '2026-11-05', dataCredito: '2026-11-06', valorTitulo: 150, valorPago: 153 },
  { nossoNumero: '23541870000000004', tipo: 'baixa', codigoBanco: '7', motivo: '7 BAIXADO', dataOcorrencia: '2026-11-06', dataCredito: undefined, valorTitulo: 80, valorPago: undefined },
]);
ok('movimento: paginação por indice, só liquidados/baixados do convênio da conta');

console.log('\nTudo certo.');

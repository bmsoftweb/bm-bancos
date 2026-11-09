/**
 * npm run teste — confere o que não depende de rede nem de banco de dados:
 * código de barras FEBRABAN, 2 de 5 intercalado, campos CNAB, OFX, cifra das
 * credenciais e, no fim, os testes de cada banco (server/bancos/*.teste.ts).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { barrasDaLinha, codigoBarras, fatorVencimento, formatarLinha, linhaDigitavel, modulo10 } from './febraban.js';
import { alfa, lerData, lerValor, num, registro, valor } from './cnab.js';
import { barrasI25 } from './pdf.js';
import { decodificarOfx, lerOfx } from './ofx.js';
import { somarDias } from './datas.js';

// Código de barras do exemplo do BB (convênio 7 posições, vencimento 31/12/2007, R$ 1,00)
const barras = codigoBarras('001', '2007-12-31', 1, '0500940144816060680935031');
assert.equal(barras, '00193373700000001000500940144816060680935031');
const linha = linhaDigitavel(barras);
assert.equal(linha.length, 47);
assert.equal(barrasDaLinha(linha), barras);
assert.match(formatarLinha(linha), /^\d{5}\.\d{5} \d{5}\.\d{6} \d{5}\.\d{6} \d \d{14}$/);
assert.equal(formatarLinha(linha), '00190.50095 40144.816069 06809.350314 3 37370000000100');
assert.equal(modulo10('001905009'), 5);
console.log('febraban: código de barras e linha digitável do exemplo do BB');

// Fator de vencimento: 9999 em 21/02/2025 e volta a 1000 em 22/02/2025
assert.equal(fatorVencimento('2025-02-21'), '9999');
assert.equal(fatorVencimento('2025-02-22'), '1000');
assert.equal(fatorVencimento('2026-11-08'), '1624');
console.log('febraban: fator de vencimento depois da virada de 22/02/2025');

// 2 de 5 intercalado: 44 dígitos = 4 de início + 22 pares x 18 + 5 de fim = 405 módulos, alternando barra e espaço
const i25 = barrasI25(barras);
assert.equal(i25.reduce((s, [w]) => s + w, 0), 405);
assert.ok(i25.every(([, barra], i) => barra === (i % 2 === 0)));
console.log('pdf: 2 de 5 intercalado com 405 módulos');

// CNAB: número que não cabe é erro; texto é cortado e sem acento
assert.equal(num(42, 5), '00042');
assert.throws(() => num(123456, 5, 'nosso número'), /nosso número/);
assert.equal(alfa('Ação & cia', 6), 'ACAO &');
assert.equal(valor(1467.45, 15), '000000000146745');
assert.throws(() => registro(240, 'x'), /240/);
assert.equal(lerValor('xx000000000146745', 3, 17), 1467.45);
assert.equal(lerData('08112026', 1, 8), '2026-11-08');
assert.equal(somarDias('2026-02-27', 2), '2026-03-01');
console.log('cnab: campos numéricos, texto, valor e data');

// OFX 1.x (SGML, windows-1252, valor com vírgula) e 2.x (XML)
const sgml = Buffer.from(
  'OFXHEADER:100\r\nDATA:OFXSGML\r\nCHARSET:1252\r\n\r\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><BANKID>0756<ACCTID>12345-6</BANKACCTFROM>' +
    '<BANKTRANLIST><DTSTART>20261101<DTEND>20261107' +
    '<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261105120000[-3:BRT]<TRNAMT>1.234,56<FITID>A1<MEMO>Liquidação cobrança</STMTTRN>' +
    '<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261106<TRNAMT>-10.00<FITID>A2<NAME>Tarifa</STMTTRN>' +
    '</BANKTRANLIST><LEDGERBAL><BALAMT>5000.00<DTASOF>20261107</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>',
  'latin1',
);
const o1 = lerOfx(decodificarOfx(sgml));
assert.equal(o1.conta, '12345-6');
assert.deepEqual([o1.dataInicial, o1.dataFinal, o1.saldo, o1.dataSaldo], ['2026-11-01', '2026-11-07', 5000, '2026-11-07']);
assert.deepEqual(o1.lancamentos.map((l) => [l.fitid, l.data, l.valor]), [['A1', '2026-11-05', 1234.56], ['A2', '2026-11-06', -10]]);
assert.equal(o1.lancamentos[0].historico, 'Liquidação cobrança');
const o2 = lerOfx(
  '<?xml version="1.0" encoding="utf-8"?><OFX><BANKTRANLIST><STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20261102</DTPOSTED>' +
    '<TRNAMT>99.90</TRNAMT><FITID>X9</FITID></STMTTRN></BANKTRANLIST></OFX>',
);
assert.deepEqual(o2.lancamentos.map((l) => [l.fitid, l.valor]), [['X9', 99.9]]);
assert.throws(() => lerOfx('nada'), /OFX/);
console.log('ofx: 1.x SGML em windows-1252 e 2.x XML');

// Cifra das credenciais (só com CHAVE_CREDENCIAIS de teste, para não depender do .env)
process.env.CHAVE_CREDENCIAIS ||= Buffer.alloc(32, 7).toString('base64');
const { cifrar, decifrar } = await import('./cripto.js');
const c = cifrar('segredo-do-banco')!;
assert.ok(c.startsWith('v1:') && !c.includes('segredo'));
assert.equal(decifrar(c), 'segredo-do-banco');
assert.equal(cifrar(''), null);
assert.throws(() => decifrar(c.slice(0, -4) + 'AAAA'), /decifrar/);
console.log('cripto: AES-256-GCM ida e volta');

// Testes de cada banco
for (const arq of fs.readdirSync(new URL('../bancos/', import.meta.url)).filter((f) => f.endsWith('.teste.ts')).sort()) {
  console.log(`\n--- ${arq}`);
  await import(`../bancos/${arq.replace(/\.ts$/, '.js')}`);
}

console.log('\nAutoteste OK');

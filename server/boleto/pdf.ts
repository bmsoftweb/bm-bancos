/**
 * PDF do boleto: recibo do pagador em cima, ficha de compensação embaixo, um
 * boleto por página A4. Gerado na hora a partir do que está gravado (o PDF
 * não é guardado).
 *
 * O código de barras (2 de 5 intercalado) é desenhado em vetor, com a razão
 * 1:3 entre barra fina e grossa e 103 mm de largura, como pede a FEBRABAN.
 */
import PDFDocument from 'pdfkit';
import bwipjs from 'bwip-js/node';
import { paraBR } from './datas.js';
import { formatarLinha } from './febraban.js';
import { boletoDaLinha } from './boletos.js';
import { Conta, ModuloBanco } from './tipos.js';
import { arquivoRecurso } from './recursos.js';

const MM = 72 / 25.4;

const moeda = (v: number | null | undefined) =>
  Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatarDocumento = (d: string) =>
  d.length === 11
    ? d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
    : d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

const cep = (c: string) => (c || '').replace(/^(\d{5})(\d{3})$/, '$1-$2');

/** DV do código do banco impresso ao lado dele ("001-9"): módulo 11 do código */
function codigoBancoImpresso(codigo: string): string {
  let soma = 0;
  for (let i = 0; i < 3; i++) soma += Number(codigo[i]) * [4, 3, 2][i];
  const r = 11 - (soma % 11);
  return `${codigo}-${r === 10 ? 'X' : r === 11 ? '0' : r}`;
}

// 2 de 5 intercalado: largura (fina = n, grossa = w) dos 5 elementos de cada dígito
const I25 = ['nnwwn', 'wnnnw', 'nwnnw', 'wwnnn', 'nnwnw', 'wnwnn', 'nwwnn', 'nnnww', 'wnnwn', 'nwnwn'];

/** Barras do 2 de 5 intercalado: [larguraEmUnidades, ehBarra][] */
export function barrasI25(numero: string): [number, boolean][] {
  if (numero.length % 2) throw new Error('2 de 5 intercalado exige quantidade par de dígitos.');
  const u = (c: string) => (c === 'w' ? 3 : 1);
  const r: [number, boolean][] = [[1, true], [1, false], [1, true], [1, false]]; // início
  for (let i = 0; i < numero.length; i += 2) {
    const a = I25[Number(numero[i])];
    const b = I25[Number(numero[i + 1])];
    for (let k = 0; k < 5; k++) r.push([u(a[k]), true], [u(b[k]), false]);
  }
  r.push([3, true], [1, false], [1, true]); // fim
  return r;
}

function desenharBarras(doc: PDFKit.PDFDocument, numero: string, x: number, y: number) {
  const barras = barrasI25(numero);
  const unidades = barras.reduce((s, [w]) => s + w, 0);
  const unidade = (103 * MM) / unidades;
  let cx = x;
  for (const [w, barra] of barras) {
    if (barra) doc.rect(cx, y, w * unidade, 13 * MM).fill('#000');
    cx += w * unidade;
  }
}

interface Celula {
  rotulo: string;
  valor?: string;
  largura: number;
  alinhar?: 'left' | 'right' | 'center';
  negrito?: boolean;
}

/** Linha de células com borda, rótulo pequeno em cima e valor embaixo */
function linhaCelulas(doc: PDFKit.PDFDocument, x: number, y: number, altura: number, celulas: Celula[]) {
  let cx = x;
  for (const c of celulas) {
    const w = c.largura * MM;
    doc.lineWidth(0.5).rect(cx, y, w, altura).stroke('#000');
    doc.font('Helvetica').fontSize(5.5).fillColor('#333').text(c.rotulo, cx + 1.5, y + 1.5, { width: w - 3, lineBreak: false });
    if (c.valor) {
      doc.font(c.negrito ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor('#000')
        .text(c.valor, cx + 1.5, y + altura - 10.5, { width: w - 3, align: c.alinhar || 'left', lineBreak: false, ellipsis: true });
    }
    cx += w;
  }
}

/** Cabeçalho: logo | código do banco | texto à direita */
function cabecalho(doc: PDFKit.PDFDocument, conta: Conta, nomeBanco: string, x: number, y: number, direita: string, tamanhoDireita: number) {
  const logo = arquivoRecurso('logos', `${conta.bancoCodigo}.png`);
  if (logo) doc.image(logo, x, y + 2, { height: 7 * MM });
  else doc.font('Helvetica-Bold').fontSize(10).fillColor('#000').text(nomeBanco, x, y + 6, { width: 45 * MM, lineBreak: false });
  doc.lineWidth(1.2).moveTo(x + 47 * MM, y + 1 * MM).lineTo(x + 47 * MM, y + 9 * MM).moveTo(x + 66 * MM, y + 1 * MM).lineTo(x + 66 * MM, y + 9 * MM).stroke('#000');
  doc.font('Helvetica-Bold').fontSize(14).text(codigoBancoImpresso(conta.bancoCodigo), x + 47 * MM, y + 2.6 * MM, { width: 19 * MM, align: 'center', lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(tamanhoDireita).text(direita, x + 67 * MM, y + 3.5 * MM, { width: 123 * MM, align: 'right', lineBreak: false });
  doc.lineWidth(1.2).moveTo(x, y + 10 * MM).lineTo(x + 190 * MM, y + 10 * MM).stroke('#000');
}

/** Linhas de instrução: as da conta, multa, juros, desconto, protesto e as mensagens do boleto */
export function instrucoesDoBoleto(b: ReturnType<typeof boletoDaLinha>, conta: Conta): string[] {
  const r: string[] = [];
  if (b.multa) r.push(`Após ${paraBR(b.multa.data, false)}, cobrar multa de ${moeda(b.multa.percentual)}% (R$ ${moeda((b.valor * b.multa.percentual) / 100)}).`);
  if (b.juros) {
    const dia = Math.round(((b.valor * b.juros.percentualMensal) / 100 / 30) * 100) / 100;
    r.push(`Após ${paraBR(b.juros.data, false)}, cobrar juros de ${moeda(b.juros.percentualMensal)}% ao mês (R$ ${moeda(dia)} ao dia).`);
  }
  if (b.desconto) r.push(`Até ${paraBR(b.desconto.data, false)}, conceder desconto de R$ ${moeda(b.desconto.valor)}.`);
  if (b.abatimento) r.push(`Abatimento de R$ ${moeda(b.abatimento)}.`);
  if (Number(b.diasProtesto) > 0) r.push(`Sujeito a protesto ${b.diasProtesto} dias após o vencimento.`);
  r.push(...String(conta.config.instrucoes || '').split('\n').map((l) => l.trim()).filter(Boolean));
  r.push(...(b.mensagens || []));
  return r;
}

export interface ItemPdf {
  linha: any;
  conta: Conta;
  modulo: ModuloBanco;
}

export async function gerarPdf(itens: ItemPdf[]): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false, info: { Title: 'Boleto', Producer: 'BMBancos' } });
  const partes: Buffer[] = [];
  doc.on('data', (p) => partes.push(p));
  const fim = new Promise<Buffer>((ok) => doc.on('end', () => ok(Buffer.concat(partes))));

  for (const { linha: l, conta, modulo } of itens) {
    const b = boletoDaLinha(l);
    if (!l.codigo_barras || !l.linha_digitavel) throw new Error(`O boleto ${l.id} não tem código de barras.`);
    doc.addPage();
    const x = 10 * MM;
    const e = conta.empresa;
    const beneficiario = `${e.razaoSocial} — CNPJ ${formatarDocumento(e.cnpj)}`;
    const enderecoBenef = [e.logradouro, e.numero, e.complemento, e.bairro, `${e.cidade}/${e.uf}`, cep(e.cep)].filter(Boolean).join(', ');
    const g = b.pagador;
    const pagador = `${g.nome} — ${g.documento.length === 11 ? 'CPF' : 'CNPJ'} ${formatarDocumento(g.documento)}`;
    const enderecoPag = [g.logradouro, g.numero, g.complemento, g.bairro].filter(Boolean).join(', ') + ` — ${cep(g.cep)} ${g.cidade}/${g.uf}`;
    const venc = paraBR(b.dataVencimento, false);
    const nossoNumero = modulo.nossoNumeroImpresso(conta, l.nosso_numero, l.nosso_numero_dv || '');
    const agCod = modulo.agenciaCodigoBeneficiario(conta);
    const linhaFmt = formatarLinha(l.linha_digitavel);
    const local = conta.config.localPagamento || 'Pagável em qualquer banco até o vencimento. Após, somente no ' + modulo.nome + '.';

    // ------------------------------------------------------------------
    // Recibo do pagador
    // ------------------------------------------------------------------
    let y = 10 * MM;
    cabecalho(doc, conta, modulo.nome, x, y, 'RECIBO DO PAGADOR', 10);
    y += 10 * MM;
    const h = 8.5 * MM;
    linhaCelulas(doc, x, y, h, [
      { rotulo: 'Beneficiário', valor: beneficiario, largura: 110 },
      { rotulo: 'Agência / Código do beneficiário', valor: agCod, largura: 45, alinhar: 'right' },
      { rotulo: 'Vencimento', valor: venc, largura: 35, alinhar: 'right', negrito: true },
    ]);
    y += h;
    linhaCelulas(doc, x, y, h, [
      { rotulo: 'Pagador', valor: pagador, largura: 110 },
      { rotulo: 'Nosso número', valor: nossoNumero, largura: 45, alinhar: 'right' },
      { rotulo: '(=) Valor do documento', valor: moeda(b.valor), largura: 35, alinhar: 'right', negrito: true },
    ]);
    y += h;
    linhaCelulas(doc, x, y, h, [
      { rotulo: 'Data do documento', valor: paraBR(b.dataEmissao, false), largura: 30, alinhar: 'center' },
      { rotulo: 'Nº do documento', valor: b.seuNumero, largura: 35, alinhar: 'center' },
      { rotulo: 'Espécie doc.', valor: b.especie, largura: 20, alinhar: 'center' },
      { rotulo: 'Carteira', valor: modulo.carteiraImpressa(conta), largura: 25, alinhar: 'center' },
      { rotulo: '(-) Desconto / Abatimento', largura: 45 },
      { rotulo: '(=) Valor cobrado', largura: 35 },
    ]);
    y += h;
    doc.font('Helvetica').fontSize(7).fillColor('#000').text(linhaFmt, x, y + 2 * MM, { width: 140 * MM, lineBreak: false });
    doc.fontSize(5.5).fillColor('#333').text('Autenticação mecânica', x + 140 * MM, y + 2 * MM, { width: 50 * MM, align: 'right', lineBreak: false });

    // PIX do boleto híbrido, ao lado do recibo
    if (l.pix_emv) {
      const qr = await bwipjs.toBuffer({ bcid: 'qrcode', text: l.pix_emv, scale: 3, eclevel: 'M' } as any);
      doc.image(qr, x + 160 * MM, y + 6 * MM, { width: 28 * MM });
      doc.font('Helvetica-Bold').fontSize(7).fillColor('#000').text('Pague com PIX', x + 120 * MM, y + 12 * MM, { width: 38 * MM, align: 'right' });
      doc.font('Helvetica').fontSize(6).fillColor('#333').text('Aponte a câmera do app do seu banco para o QR Code.', x + 110 * MM, y + 16 * MM, { width: 48 * MM, align: 'right' });
    }

    // Linha de corte
    y = 105 * MM;
    doc.lineWidth(0.5).dash(3, { space: 3 }).moveTo(x, y).lineTo(x + 190 * MM, y).stroke('#666').undash();
    doc.font('Helvetica').fontSize(6).fillColor('#666').text('Corte na linha pontilhada', x, y + 1.2 * MM, { width: 190 * MM, align: 'right' });

    // ------------------------------------------------------------------
    // Ficha de compensação
    // ------------------------------------------------------------------
    y = 112 * MM;
    cabecalho(doc, conta, modulo.nome, x, y, linhaFmt, 11);
    y += 10 * MM;
    const esq = 145;
    const dir = 45;
    linhaCelulas(doc, x, y, h, [
      { rotulo: 'Local de pagamento', valor: local, largura: esq },
      { rotulo: 'Vencimento', valor: venc, largura: dir, alinhar: 'right', negrito: true },
    ]);
    y += h;
    // Mais alta que as outras: nome e, embaixo, o endereço do beneficiário
    const hb = h + 2.5 * MM;
    linhaCelulas(doc, x, y, hb, [
      { rotulo: 'Beneficiário', largura: esq },
      { rotulo: 'Agência / Código do beneficiário', valor: agCod, largura: dir, alinhar: 'right' },
    ]);
    doc.font('Helvetica').fontSize(8).fillColor('#000').text(beneficiario, x + 1.5, y + 8, { width: esq * MM - 3, lineBreak: false, ellipsis: true });
    doc.fontSize(6).text(enderecoBenef, x + 1.5, y + hb - 8, { width: esq * MM - 3, lineBreak: false, ellipsis: true });
    y += hb;
    linhaCelulas(doc, x, y, h, [
      { rotulo: 'Data do documento', valor: paraBR(b.dataEmissao, false), largura: 28, alinhar: 'center' },
      { rotulo: 'Nº do documento', valor: b.seuNumero, largura: 37, alinhar: 'center' },
      { rotulo: 'Espécie doc.', valor: b.especie, largura: 20, alinhar: 'center' },
      { rotulo: 'Aceite', valor: b.aceite, largura: 20, alinhar: 'center' },
      { rotulo: 'Data do processamento', valor: paraBR(String(l.criado_em || b.dataEmissao).slice(0, 10), false), largura: 40, alinhar: 'center' },
      { rotulo: 'Nosso número', valor: nossoNumero, largura: dir, alinhar: 'right' },
    ]);
    y += h;
    linhaCelulas(doc, x, y, h, [
      { rotulo: 'Uso do banco', largura: 28 },
      { rotulo: 'Carteira', valor: modulo.carteiraImpressa(conta), largura: 37, alinhar: 'center' },
      { rotulo: 'Espécie', valor: 'R$', largura: 20, alinhar: 'center' },
      { rotulo: 'Quantidade', largura: 20 },
      { rotulo: 'Valor', largura: 40 },
      { rotulo: '(=) Valor do documento', valor: moeda(b.valor), largura: dir, alinhar: 'right', negrito: true },
    ]);
    y += h;

    // Instruções à esquerda, deduções/acréscimos à direita
    const hInstr = 5 * h;
    doc.lineWidth(0.5).rect(x, y, esq * MM, hInstr).stroke('#000');
    doc.font('Helvetica').fontSize(5.5).fillColor('#333').text('Instruções (texto de responsabilidade do beneficiário)', x + 1.5, y + 1.5);
    doc.font('Helvetica').fontSize(7.5).fillColor('#000').text(instrucoesDoBoleto(b, conta).join('\n'), x + 1.5, y + 9, { width: esq * MM - 3, height: hInstr - 11, ellipsis: true });
    const rotulosDir = ['(-) Desconto / Abatimento', '(-) Outras deduções', '(+) Mora / Multa', '(+) Outros acréscimos', '(=) Valor cobrado'];
    rotulosDir.forEach((r, i) =>
      linhaCelulas(doc, x + esq * MM, y + i * h, h, [{ rotulo: r, valor: i === 0 && b.abatimento ? moeda(b.abatimento) : '', largura: dir, alinhar: 'right' }]),
    );
    y += hInstr;

    // Pagador
    const hPag = 14 * MM;
    doc.lineWidth(0.5).rect(x, y, 190 * MM, hPag).stroke('#000');
    doc.font('Helvetica').fontSize(5.5).fillColor('#333').text('Pagador', x + 1.5, y + 1.5);
    doc.font('Helvetica').fontSize(8).fillColor('#000').text(pagador, x + 1.5, y + 9, { width: 186 * MM, lineBreak: false, ellipsis: true });
    doc.fontSize(7.5).text(enderecoPag, x + 1.5, y + 19, { width: 186 * MM, lineBreak: false, ellipsis: true });
    doc.font('Helvetica').fontSize(5.5).fillColor('#333').text('Sacador / Avalista', x + 1.5, y + hPag - 8);
    y += hPag;
    doc.font('Helvetica').fontSize(5.5).fillColor('#333').text('Autenticação mecânica — FICHA DE COMPENSAÇÃO', x + 100 * MM, y + 1.5, { width: 90 * MM, align: 'right' });

    desenharBarras(doc, l.codigo_barras, x + 2 * MM, y + 5 * MM);
  }

  doc.end();
  return fim;
}

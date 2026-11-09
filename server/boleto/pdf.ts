/**
 * PDF do boleto, gerado na hora a partir do que está gravado (o PDF não é
 * guardado). Dois modelos, escolhidos na conta (config.modeloImpressao):
 *  - folha: recibo do pagador em cima, ficha de compensação embaixo, um boleto por A4;
 *  - carne: três por A4, cada um com o canhoto (recibo) à esquerda e a ficha à direita.
 *
 * O código de barras (2 de 5 intercalado) é desenhado em vetor, com a razão
 * 1:3 entre barra fina e grossa, 103 mm de largura e 13 mm de altura nos dois
 * modelos, como pede a FEBRABAN.
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

const qrPix = (emv: string) => bwipjs.toBuffer({ bcid: 'qrcode', text: emv, scale: 3, eclevel: 'M' } as any);

interface Celula {
  rotulo: string;
  valor?: string;
  largura: number;
  alinhar?: 'left' | 'right' | 'center';
  negrito?: boolean;
  /** Tamanho da letra do valor (padrão 8) */
  tamanho?: number;
}

/** Linha de células com borda, rótulo pequeno em cima e valor embaixo */
function linhaCelulas(doc: PDFKit.PDFDocument, x: number, y: number, altura: number, celulas: Celula[]) {
  let cx = x;
  for (const c of celulas) {
    const w = c.largura * MM;
    const t = c.tamanho || 8;
    doc.lineWidth(0.5).rect(cx, y, w, altura).stroke('#000');
    doc.font('Helvetica').fontSize(5.5).fillColor('#333').text(c.rotulo, cx + 1.5, y + 1.5, { width: w - 3, lineBreak: false });
    if (c.valor) {
      doc.font(c.negrito ? 'Helvetica-Bold' : 'Helvetica').fontSize(t).fillColor('#000')
        .text(c.valor, cx + 1.5, y + altura - t - 2.5, { width: w - 3, align: c.alinhar || 'left', lineBreak: false, ellipsis: true });
    }
    cx += w;
  }
}

/** Medidas do cabeçalho (mm): largura total, altura, altura do logo e as duas barras em volta do código */
interface Cab {
  largura: number;
  altura: number;
  logo: number;
  barras: [number, number];
  fonteCodigo: number;
}
const CAB_FOLHA: Cab = { largura: 190, altura: 10, logo: 7, barras: [47, 66], fonteCodigo: 14 };
const CAB_FICHA_CARNE: Cab = { largura: 144, altura: 8, logo: 5.5, barras: [23, 38], fonteCodigo: 12 };
const CAB_CANHOTO: Cab = { largura: 46, altura: 8, logo: 4.5, barras: [19, 34], fonteCodigo: 11 };

/** Cabeçalho: logo | código do banco | texto à direita */
function cabecalho(doc: PDFKit.PDFDocument, conta: Conta, nomeBanco: string, x: number, y: number, direita: string, tamanhoDireita: number, c = CAB_FOLHA) {
  const k = c.altura / 10;
  const [b1, b2] = c.barras;
  const logo = arquivoRecurso('logos', `${conta.bancoCodigo}.png`);
  if (logo) doc.image(logo, x, y + 2 * k, { height: c.logo * MM });
  else doc.font('Helvetica-Bold').fontSize(10 * k).fillColor('#000').text(nomeBanco, x, y + 6 * k, { width: (b1 - 2) * MM, lineBreak: false, ellipsis: true });
  doc.lineWidth(1.2).moveTo(x + b1 * MM, y + 1 * k * MM).lineTo(x + b1 * MM, y + 9 * k * MM).moveTo(x + b2 * MM, y + 1 * k * MM).lineTo(x + b2 * MM, y + 9 * k * MM).stroke('#000');
  doc.font('Helvetica-Bold').fontSize(c.fonteCodigo).fillColor('#000').text(codigoBancoImpresso(conta.bancoCodigo), x + b1 * MM, y + 2.6 * k * MM, { width: (b2 - b1) * MM, align: 'center', lineBreak: false });
  if (direita) doc.font('Helvetica-Bold').fontSize(tamanhoDireita).text(direita, x + (b2 + 1) * MM, y + 3.5 * k * MM, { width: (c.largura - b2 - 1) * MM, align: 'right', lineBreak: false });
  doc.lineWidth(1.2).moveTo(x, y + c.altura * MM).lineTo(x + c.largura * MM, y + c.altura * MM).stroke('#000');
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

/** Textos do boleto já formatados, comuns aos dois modelos */
function impresso({ linha: l, conta, modulo }: ItemPdf) {
  const b = boletoDaLinha(l);
  if (!l.codigo_barras || !l.linha_digitavel) throw new Error(`O boleto ${l.id} não tem código de barras.`);
  const e = conta.empresa;
  const g = b.pagador;
  return {
    l,
    b,
    conta,
    modulo,
    beneficiario: `${e.razaoSocial} — CNPJ ${formatarDocumento(e.cnpj)}`,
    enderecoBenef: [e.logradouro, e.numero, e.complemento, e.bairro, `${e.cidade}/${e.uf}`, cep(e.cep)].filter(Boolean).join(', '),
    pagador: `${g.nome} — ${g.documento.length === 11 ? 'CPF' : 'CNPJ'} ${formatarDocumento(g.documento)}`,
    enderecoPag: [g.logradouro, g.numero, g.complemento, g.bairro].filter(Boolean).join(', ') + ` — ${cep(g.cep)} ${g.cidade}/${g.uf}`,
    venc: paraBR(b.dataVencimento, false),
    nossoNumero: modulo.nossoNumeroImpresso(conta, l.nosso_numero, l.nosso_numero_dv || ''),
    agCod: modulo.agenciaCodigoBeneficiario(conta),
    linhaFmt: formatarLinha(l.linha_digitavel),
    local: conta.config.localPagamento || 'Pagável em qualquer banco até o vencimento. Após, somente no ' + modulo.nome + '.',
    carteira: modulo.carteiraImpressa(conta),
    emissao: paraBR(b.dataEmissao, false),
    processamento: paraBR(String(l.criado_em || b.dataEmissao).slice(0, 10), false),
    valor: moeda(b.valor),
    abatimento: b.abatimento ? moeda(b.abatimento) : '',
    instrucoes: instrucoesDoBoleto(b, conta),
  };
}
type Impresso = ReturnType<typeof impresso>;

/** Modelo folha: recibo do pagador em cima e ficha de compensação embaixo, numa A4 */
async function folha(doc: PDFKit.PDFDocument, d: Impresso) {
  const { l, b, conta, modulo } = d;
  const x = 10 * MM;

  // ------------------------------------------------------------------
  // Recibo do pagador
  // ------------------------------------------------------------------
  let y = 10 * MM;
  cabecalho(doc, conta, modulo.nome, x, y, 'RECIBO DO PAGADOR', 10);
  y += 10 * MM;
  const h = 8.5 * MM;
  linhaCelulas(doc, x, y, h, [
    { rotulo: 'Beneficiário', valor: d.beneficiario, largura: 110 },
    { rotulo: 'Agência / Código do beneficiário', valor: d.agCod, largura: 45, alinhar: 'right' },
    { rotulo: 'Vencimento', valor: d.venc, largura: 35, alinhar: 'right', negrito: true },
  ]);
  y += h;
  linhaCelulas(doc, x, y, h, [
    { rotulo: 'Pagador', valor: d.pagador, largura: 110 },
    { rotulo: 'Nosso número', valor: d.nossoNumero, largura: 45, alinhar: 'right' },
    { rotulo: '(=) Valor do documento', valor: d.valor, largura: 35, alinhar: 'right', negrito: true },
  ]);
  y += h;
  linhaCelulas(doc, x, y, h, [
    { rotulo: 'Data do documento', valor: d.emissao, largura: 30, alinhar: 'center' },
    { rotulo: 'Nº do documento', valor: b.seuNumero, largura: 35, alinhar: 'center' },
    { rotulo: 'Espécie doc.', valor: b.especie, largura: 20, alinhar: 'center' },
    { rotulo: 'Carteira', valor: d.carteira, largura: 25, alinhar: 'center' },
    { rotulo: '(-) Desconto / Abatimento', largura: 45 },
    { rotulo: '(=) Valor cobrado', largura: 35 },
  ]);
  y += h;
  doc.font('Helvetica').fontSize(7).fillColor('#000').text(d.linhaFmt, x, y + 2 * MM, { width: 140 * MM, lineBreak: false });
  doc.fontSize(5.5).fillColor('#333').text('Autenticação mecânica', x + 140 * MM, y + 2 * MM, { width: 50 * MM, align: 'right', lineBreak: false });

  // PIX do boleto híbrido, ao lado do recibo
  if (l.pix_emv) {
    doc.image(await qrPix(l.pix_emv), x + 160 * MM, y + 6 * MM, { width: 28 * MM });
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
  cabecalho(doc, conta, modulo.nome, x, y, d.linhaFmt, 11);
  y += 10 * MM;
  const esq = 145;
  const dir = 45;
  linhaCelulas(doc, x, y, h, [
    { rotulo: 'Local de pagamento', valor: d.local, largura: esq },
    { rotulo: 'Vencimento', valor: d.venc, largura: dir, alinhar: 'right', negrito: true },
  ]);
  y += h;
  // Mais alta que as outras: nome e, embaixo, o endereço do beneficiário
  const hb = h + 2.5 * MM;
  linhaCelulas(doc, x, y, hb, [
    { rotulo: 'Beneficiário', largura: esq },
    { rotulo: 'Agência / Código do beneficiário', valor: d.agCod, largura: dir, alinhar: 'right' },
  ]);
  doc.font('Helvetica').fontSize(8).fillColor('#000').text(d.beneficiario, x + 1.5, y + 8, { width: esq * MM - 3, lineBreak: false, ellipsis: true });
  doc.fontSize(6).text(d.enderecoBenef, x + 1.5, y + hb - 8, { width: esq * MM - 3, lineBreak: false, ellipsis: true });
  y += hb;
  linhaCelulas(doc, x, y, h, [
    { rotulo: 'Data do documento', valor: d.emissao, largura: 28, alinhar: 'center' },
    { rotulo: 'Nº do documento', valor: b.seuNumero, largura: 37, alinhar: 'center' },
    { rotulo: 'Espécie doc.', valor: b.especie, largura: 20, alinhar: 'center' },
    { rotulo: 'Aceite', valor: b.aceite, largura: 20, alinhar: 'center' },
    { rotulo: 'Data do processamento', valor: d.processamento, largura: 40, alinhar: 'center' },
    { rotulo: 'Nosso número', valor: d.nossoNumero, largura: dir, alinhar: 'right' },
  ]);
  y += h;
  linhaCelulas(doc, x, y, h, [
    { rotulo: 'Uso do banco', largura: 28 },
    { rotulo: 'Carteira', valor: d.carteira, largura: 37, alinhar: 'center' },
    { rotulo: 'Espécie', valor: 'R$', largura: 20, alinhar: 'center' },
    { rotulo: 'Quantidade', largura: 20 },
    { rotulo: 'Valor', largura: 40 },
    { rotulo: '(=) Valor do documento', valor: d.valor, largura: dir, alinhar: 'right', negrito: true },
  ]);
  y += h;

  // Instruções à esquerda, deduções/acréscimos à direita
  const hInstr = 5 * h;
  doc.lineWidth(0.5).rect(x, y, esq * MM, hInstr).stroke('#000');
  doc.font('Helvetica').fontSize(5.5).fillColor('#333').text('Instruções (texto de responsabilidade do beneficiário)', x + 1.5, y + 1.5);
  doc.font('Helvetica').fontSize(7.5).fillColor('#000').text(d.instrucoes.join('\n'), x + 1.5, y + 9, { width: esq * MM - 3, height: hInstr - 11, ellipsis: true });
  ROTULOS_DIREITA.forEach((r, i) =>
    linhaCelulas(doc, x + esq * MM, y + i * h, h, [{ rotulo: r, valor: i === 0 ? d.abatimento : '', largura: dir, alinhar: 'right' }]),
  );
  y += hInstr;

  // Pagador
  const hPag = 14 * MM;
  doc.lineWidth(0.5).rect(x, y, 190 * MM, hPag).stroke('#000');
  doc.font('Helvetica').fontSize(5.5).fillColor('#333').text('Pagador', x + 1.5, y + 1.5);
  doc.font('Helvetica').fontSize(8).fillColor('#000').text(d.pagador, x + 1.5, y + 9, { width: 186 * MM, lineBreak: false, ellipsis: true });
  doc.fontSize(7.5).text(d.enderecoPag, x + 1.5, y + 19, { width: 186 * MM, lineBreak: false, ellipsis: true });
  doc.font('Helvetica').fontSize(5.5).fillColor('#333').text('Sacador / Avalista', x + 1.5, y + hPag - 8);
  y += hPag;
  doc.font('Helvetica').fontSize(5.5).fillColor('#333').text('Autenticação mecânica — FICHA DE COMPENSAÇÃO', x + 100 * MM, y + 1.5, { width: 90 * MM, align: 'right' });

  desenharBarras(doc, l.codigo_barras, x + 2 * MM, y + 5 * MM);
}

const ROTULOS_DIREITA = ['(-) Desconto / Abatimento', '(-) Outras deduções', '(+) Mora / Multa', '(+) Outros acréscimos', '(=) Valor cobrado'];

/** Altura de cada boleto do carnê: três por A4 (297 mm) */
const VAGA_CARNE = 99;

/**
 * Modelo carnê, na vaga 0, 1 ou 2 da página: canhoto de 46 mm à esquerda (fica
 * no carnê) e ficha de 144 mm à direita, separados por um pontilhado.
 */
async function carne(doc: PDFKit.PDFDocument, d: Impresso, vaga: number) {
  const { l, b, conta, modulo } = d;
  const topo = vaga * VAGA_CARNE * MM;
  const h = 6.2 * MM;
  const t = 7.5;
  const largCanhoto = 46;
  const xc = 8 * MM;
  const xf = 58 * MM;
  const larg = 144;
  const dir = 38;
  const esq = larg - dir;
  const y0 = topo + 6 * MM;

  // Pontilhados: entre canhoto e ficha, e embaixo, entre um boleto e o próximo
  doc.lineWidth(0.5).dash(3, { space: 3 }).moveTo(56 * MM, topo + 4 * MM).lineTo(56 * MM, topo + (VAGA_CARNE - 4) * MM);
  if (vaga < 2) doc.moveTo(xc, topo + VAGA_CARNE * MM).lineTo(xf + larg * MM, topo + VAGA_CARNE * MM);
  doc.stroke('#666').undash();

  // ------------------------------------------------------------------
  // Canhoto (recibo do pagador)
  // ------------------------------------------------------------------
  cabecalho(doc, conta, modulo.nome, xc, y0, '', 0, CAB_CANHOTO);
  let y = y0 + CAB_CANHOTO.altura * MM;
  const canhoto: Omit<Celula, 'largura'>[] = [
    { rotulo: 'Nosso número', valor: d.nossoNumero, alinhar: 'right' },
    { rotulo: 'Vencimento', valor: d.venc, alinhar: 'right', negrito: true },
    { rotulo: 'Agência / Código do beneficiário', valor: d.agCod, alinhar: 'right' },
    { rotulo: '(=) Valor do documento', valor: d.valor, alinhar: 'right', negrito: true },
    ...ROTULOS_DIREITA.map((rotulo, i) => ({ rotulo, valor: i === 0 ? d.abatimento : '', alinhar: 'right' as const })),
    { rotulo: 'Nº do documento', valor: b.seuNumero, alinhar: 'right' },
    { rotulo: 'Pagador', valor: b.pagador.nome },
  ];
  for (const c of canhoto) {
    linhaCelulas(doc, xc, y, h, [{ ...c, largura: largCanhoto, tamanho: t }]);
    y += h;
  }
  const w = largCanhoto * MM;
  doc.font('Helvetica').fontSize(6).fillColor('#000').text(conta.empresa.razaoSocial, xc, y + 1.5 * MM, { width: w, lineBreak: false, ellipsis: true });
  doc.text(`CNPJ ${formatarDocumento(conta.empresa.cnpj)}`, xc, y + 4 * MM, { width: w, lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(7.5).text('Recibo do pagador', xc, y + 7 * MM, { width: w, lineBreak: false });
  doc.font('Helvetica').fontSize(5.5).fillColor('#333').text('Autenticação no verso', xc, y + 10 * MM, { width: w, lineBreak: false });

  // ------------------------------------------------------------------
  // Ficha de compensação
  // ------------------------------------------------------------------
  y = y0;
  cabecalho(doc, conta, modulo.nome, xf, y, d.linhaFmt, 10, CAB_FICHA_CARNE);
  y += CAB_FICHA_CARNE.altura * MM;
  linhaCelulas(doc, xf, y, h, [
    { rotulo: 'Local de pagamento', valor: d.local, largura: esq, tamanho: 7 },
    { rotulo: 'Vencimento', valor: d.venc, largura: dir, alinhar: 'right', negrito: true },
  ]);
  y += h;
  const hb = h + 2 * MM;
  linhaCelulas(doc, xf, y, hb, [
    { rotulo: 'Beneficiário', largura: esq },
    { rotulo: 'Agência / Código do beneficiário', valor: d.agCod, largura: dir, alinhar: 'right', tamanho: t },
  ]);
  doc.font('Helvetica').fontSize(7).fillColor('#000').text(d.beneficiario, xf + 1.5, y + 7.5, { width: esq * MM - 3, lineBreak: false, ellipsis: true });
  doc.fontSize(5.5).text(d.enderecoBenef, xf + 1.5, y + hb - 7, { width: esq * MM - 3, lineBreak: false, ellipsis: true });
  y += hb;
  linhaCelulas(doc, xf, y, h, [
    { rotulo: 'Data do documento', valor: d.emissao, largura: 20, alinhar: 'center', tamanho: t },
    { rotulo: 'Nº do documento', valor: b.seuNumero, largura: 26, alinhar: 'center', tamanho: t },
    { rotulo: 'Espécie doc.', valor: b.especie, largura: 16, alinhar: 'center', tamanho: t },
    { rotulo: 'Aceite', valor: b.aceite, largura: 12, alinhar: 'center', tamanho: t },
    { rotulo: 'Data do processamento', valor: d.processamento, largura: 32, alinhar: 'center', tamanho: t },
    { rotulo: 'Nosso número', valor: d.nossoNumero, largura: dir, alinhar: 'right', tamanho: t },
  ]);
  y += h;
  linhaCelulas(doc, xf, y, h, [
    { rotulo: 'Uso do banco', largura: 20 },
    { rotulo: 'Carteira', valor: d.carteira, largura: 26, alinhar: 'center', tamanho: t },
    { rotulo: 'Espécie', valor: 'R$', largura: 16, alinhar: 'center', tamanho: t },
    { rotulo: 'Quantidade', largura: 12 },
    { rotulo: 'Valor', largura: 32 },
    { rotulo: '(=) Valor do documento', valor: d.valor, largura: dir, alinhar: 'right', negrito: true },
  ]);
  y += h;

  // Instruções à esquerda (com o QR do PIX no canto, se houver), deduções/acréscimos à direita
  const hd = 5.2 * MM;
  const hInstr = 5 * hd;
  const larguraTexto = esq * MM - 3 - (l.pix_emv ? 25 * MM : 0);
  doc.lineWidth(0.5).rect(xf, y, esq * MM, hInstr).stroke('#000');
  doc.font('Helvetica').fontSize(5.5).fillColor('#333').text('Instruções (texto de responsabilidade do beneficiário)', xf + 1.5, y + 1.5);
  const instrucoes = l.pix_emv ? [...d.instrucoes, 'Pague também com PIX pelo QR Code ao lado.'] : d.instrucoes;
  doc.font('Helvetica').fontSize(7).fillColor('#000').text(instrucoes.join('\n'), xf + 1.5, y + 8, { width: larguraTexto, height: hInstr - 9, ellipsis: true });
  if (l.pix_emv) doc.image(await qrPix(l.pix_emv), xf + (esq - 24) * MM, y + 2 * MM, { width: 22 * MM });
  ROTULOS_DIREITA.forEach((r, i) =>
    linhaCelulas(doc, xf + esq * MM, y + i * hd, hd, [{ rotulo: r, valor: i === 0 ? d.abatimento : '', largura: dir, alinhar: 'right', tamanho: 7 }]),
  );
  y += hInstr;

  // Pagador
  const hPag = 11 * MM;
  doc.lineWidth(0.5).rect(xf, y, larg * MM, hPag).stroke('#000');
  doc.font('Helvetica').fontSize(5.5).fillColor('#333').text('Pagador', xf + 1.5, y + 1.5);
  doc.font('Helvetica').fontSize(7.5).fillColor('#000').text(d.pagador, xf + 1.5, y + 7.5, { width: larg * MM - 3, lineBreak: false, ellipsis: true });
  doc.fontSize(7).text(d.enderecoPag, xf + 1.5, y + 15, { width: larg * MM - 3, lineBreak: false, ellipsis: true });
  doc.font('Helvetica').fontSize(5.5).fillColor('#333').text('Sacador / Avalista', xf + 1.5, y + hPag - 7);
  y += hPag;
  doc.font('Helvetica').fontSize(5.5).fillColor('#333').text('Ficha de compensação\nAutenticação mecânica', xf + 106 * MM, y + 1.2, { width: 38 * MM, align: 'right' });

  desenharBarras(doc, l.codigo_barras, xf + 2 * MM, y + 1.5 * MM);
}

export async function gerarPdf(itens: ItemPdf[]): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false, info: { Title: 'Boleto', Producer: 'BMBancos' } });
  const partes: Buffer[] = [];
  doc.on('data', (p) => partes.push(p));
  const fim = new Promise<Buffer>((ok) => doc.on('end', () => ok(Buffer.concat(partes))));

  // Boletos de carnê vão preenchendo as três vagas da página; o de folha ocupa uma página inteira
  let vaga = 3;
  for (const item of itens) {
    const d = impresso(item);
    if (item.conta.config.modeloImpressao === 'carne') {
      if (vaga === 3) {
        doc.addPage();
        vaga = 0;
      }
      await carne(doc, d, vaga++);
    } else {
      doc.addPage();
      vaga = 3;
      await folha(doc, d);
    }
  }

  doc.end();
  return fim;
}

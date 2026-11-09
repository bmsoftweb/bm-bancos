/**
 * Extrato OFX (1.x em SGML ou 2.x em XML) e conciliação.
 *
 * O FITID único por conta faz extratos com períodos sobrepostos não
 * duplicarem lançamento. A conciliação em si é do módulo financeiro: ele lê
 * os pendentes, casa com os lançamentos do ERP e devolve a referência dele.
 */
import crypto from 'crypto';
import { pool } from '../db.js';
import { dataHoraMysql } from './datas.js';
import { Conflito } from './boletos.js';
import { carregarConta } from './contas.js';

export interface LancamentoOfx {
  fitid: string;
  data: string;
  valor: number;
  tipo: string;
  documento: string;
  historico: string;
}

export interface ExtratoOfx {
  banco: string;
  conta: string;
  dataInicial: string;
  dataFinal: string;
  saldo: number | null;
  dataSaldo: string;
  lancamentos: LancamentoOfx[];
}

/** O OFX dos bancos brasileiros costuma vir em windows-1252 (CHARSET:1252) */
export function decodificarOfx(buf: Buffer): string {
  const cabecalho = buf.subarray(0, 600).toString('latin1');
  const utf8 = /ENCODING:\s*UTF-8|encoding="utf-8"/i.test(cabecalho) && !/CHARSET:\s*1252/i.test(cabecalho);
  return new TextDecoder(utf8 ? 'utf-8' : 'windows-1252').decode(buf);
}

/** Valor de uma tag folha: <TAG>valor (SGML, sem fechamento) ou <TAG>valor</TAG> */
const tag = (bloco: string, nome: string) => (bloco.match(new RegExp(`<${nome}>([^<\\r\\n]*)`, 'i'))?.[1] ?? '').trim();

/** "20261108120000[-3:BRT]" -> "2026-11-08" */
const dataOfx = (s: string) => (/^\d{8}/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : '');

/** Alguns bancos mandam "-1.234,56" ou "-1234,56" no lugar de "-1234.56" */
function valorOfx(s: string): number {
  let t = s.replace(/\s/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  if (!Number.isFinite(n)) throw new Error(`Valor inválido no OFX: "${s}".`);
  return Math.round(n * 100) / 100;
}

export function lerOfx(texto: string): ExtratoOfx {
  if (!/<OFX>/i.test(texto)) throw new Error('O arquivo não é um OFX (falta a tag <OFX>).');
  const lancamentos: LancamentoOfx[] = [];
  for (const m of texto.matchAll(/<STMTTRN>([\s\S]*?)(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>)/gi)) {
    const b = m[1];
    const data = dataOfx(tag(b, 'DTPOSTED'));
    const valor = valorOfx(tag(b, 'TRNAMT') || '0');
    const documento = tag(b, 'CHECKNUM') || tag(b, 'REFNUM');
    const historico = [tag(b, 'NAME'), tag(b, 'MEMO')].filter(Boolean).join(' - ');
    // ponytail: sem FITID usa hash dos campos; banco que troca o FITID a cada download duplica
    const fitid = tag(b, 'FITID') || crypto.createHash('sha256').update(`${data}|${valor}|${documento}|${historico}`).digest('hex');
    if (!data) throw new Error(`Lançamento sem data no OFX (FITID ${fitid}).`);
    lancamentos.push({ fitid: fitid.slice(0, 255), data, valor, tipo: tag(b, 'TRNTYPE').toUpperCase(), documento, historico });
  }
  const datas = lancamentos.map((l) => l.data).sort();
  const saldo = tag(texto.match(/<LEDGERBAL>([\s\S]*?)(?:<\/LEDGERBAL>|<AVAILBAL>|$)/i)?.[1] || '', 'BALAMT');
  return {
    banco: tag(texto, 'BANKID'),
    conta: tag(texto, 'ACCTID'),
    dataInicial: dataOfx(tag(texto, 'DTSTART')) || datas[0] || '',
    dataFinal: dataOfx(tag(texto, 'DTEND')) || datas[datas.length - 1] || '',
    saldo: saldo ? valorOfx(saldo) : null,
    dataSaldo: dataOfx(tag(texto.match(/<LEDGERBAL>([\s\S]*?)(?:<\/LEDGERBAL>|$)/i)?.[1] || '', 'DTASOF')),
    lancamentos,
  };
}

export async function importarOfx(empresaId: number, contaId: number, nomeArquivo: string, arquivo: Buffer, usuarioId: number | null) {
  const { conta } = await carregarConta(empresaId, contaId);
  const texto = decodificarOfx(arquivo);
  const ofx = lerOfx(texto);
  if (!ofx.dataInicial) throw new Error('O OFX não tem lançamentos nem período.');

  // A conta do arquivo tem de ser a escolhida (os bancos formatam o ACCTID cada um de um jeito)
  const acct = ofx.conta.replace(/\D/g, '').replace(/^0+/, '');
  const nossa = conta.conta.replace(/\D/g, '').replace(/^0+/, '');
  if (acct && nossa && !acct.includes(nossa)) throw new Error(`O OFX é da conta ${ofx.conta}, não da conta ${conta.conta}-${conta.contaDv} selecionada.`);

  const hash = crypto.createHash('sha256').update(arquivo).digest('hex');
  const momento = dataHoraMysql();
  const con = await pool.getConnection();
  try {
    await con.beginTransaction();
    let extratoId: number;
    try {
      const [r] = await con.query<any>(
        `INSERT INTO ban_extratos (empresa_id, conta_id, origem, nome_arquivo, data_inicial, data_final, saldo, data_saldo, hash, qtde_lancamentos, conteudo, usuario_id, criado_em)
         VALUES (?, ?, 'ofx', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [empresaId, conta.id, String(nomeArquivo || 'extrato.ofx').slice(0, 120), ofx.dataInicial, ofx.dataFinal, ofx.saldo, ofx.dataSaldo || null,
          hash, ofx.lancamentos.length, texto, usuarioId, momento],
      );
      extratoId = r.insertId;
    } catch (err: any) {
      if (err?.code === 'ER_DUP_ENTRY') throw new Conflito('Este arquivo OFX já foi importado.');
      throw err;
    }

    let novos = 0;
    for (const l of ofx.lancamentos) {
      const [r] = await con.query<any>(
        `INSERT IGNORE INTO ban_extrato_lancamentos (empresa_id, conta_id, extrato_id, fitid, data_lancamento, valor, tipo, documento, historico, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [empresaId, conta.id, extratoId, l.fitid, l.data, l.valor, l.tipo.slice(0, 12) || null, l.documento.slice(0, 40) || null, l.historico.slice(0, 255) || null, momento],
      );
      novos += r.affectedRows;
    }
    await con.commit();
    const vinculados = await vincularCobranca(empresaId, conta.id, ofx.dataInicial, ofx.dataFinal);
    return { id: extratoId, lancamentos: ofx.lancamentos.length, novos, repetidos: ofx.lancamentos.length - novos, saldo: ofx.saldo, vinculados };
  } catch (err) {
    await con.rollback();
    throw err;
  } finally {
    con.release();
  }
}

/**
 * Liga as liquidações aos créditos do extrato: o banco costuma creditar a
 * cobrança de um dia num lançamento só. Casa a soma das liquidações com a
 * mesma data de crédito, bruta ou líquida de tarifa, com um crédito do mesmo
 * valor nessa data. Só liga (ban_ocorrencias.extrato_lancamento_id): conciliar
 * continua com o módulo financeiro.
 * ponytail: casa só a soma do dia inteiro; banco que divide o crédito por lote fica sem vínculo
 */
export async function vincularCobranca(empresaId: number, contaId: number, de: string, ate: string): Promise<number> {
  const [dias] = await pool.query<any[]>(
    `SELECT data_credito, SUM(valor_pago) AS bruto, SUM(valor_pago - COALESCE(valor_tarifa, 0)) AS liquido
       FROM ban_ocorrencias
      WHERE conta_id = ? AND tipo = 'liquidacao' AND extrato_lancamento_id IS NULL AND data_credito BETWEEN ? AND ?
      GROUP BY data_credito`,
    [contaId, de, ate],
  );
  let ligados = 0;
  for (const d of dias) {
    const [creditos] = await pool.query<any[]>(
      `SELECT l.id FROM ban_extrato_lancamentos l
        WHERE l.conta_id = ? AND l.data_lancamento = ? AND l.valor IN (?, ?)
          AND NOT EXISTS (SELECT 1 FROM ban_ocorrencias o WHERE o.extrato_lancamento_id = l.id)
        ORDER BY l.id LIMIT 1`,
      [contaId, d.data_credito, Number(d.bruto), Number(d.liquido)],
    );
    if (!creditos.length) continue;
    const [r] = await pool.query<any>(
      `UPDATE ban_ocorrencias SET extrato_lancamento_id = ?
        WHERE conta_id = ? AND tipo = 'liquidacao' AND extrato_lancamento_id IS NULL AND data_credito = ?`,
      [creditos[0].id, contaId, d.data_credito],
    );
    ligados += r.affectedRows;
  }
  return ligados;
}

/** pendente -> conciliado (com a referência do lançamento do ERP) ou ignorado; e o caminho de volta */
export async function marcarLancamento(empresaId: number, id: number, acao: 'conciliar' | 'ignorar' | 'desfazer', referencia: string | null, usuarioId: number | null) {
  const ref = String(referencia ?? '').trim();
  if (acao === 'conciliar' && !ref) throw new Error('Informe a referência do lançamento no ERP (ex.: MOV-789).');
  if (ref.length > 80) throw new Error('Referência maior que 80 caracteres.');

  const [sql, params]: [string, unknown[]] =
    acao === 'desfazer'
      ? ["UPDATE ban_extrato_lancamentos SET situacao = 'pendente', referencia_conciliacao = NULL, conciliado_em = NULL, usuario_id = NULL WHERE id = ? AND empresa_id = ? AND situacao <> 'pendente'", [id, empresaId]]
      : [
          "UPDATE ban_extrato_lancamentos SET situacao = ?, referencia_conciliacao = ?, conciliado_em = ?, usuario_id = ? WHERE id = ? AND empresa_id = ? AND situacao = 'pendente'",
          [acao === 'conciliar' ? 'conciliado' : 'ignorado', acao === 'conciliar' ? ref : null, dataHoraMysql(), usuarioId, id, empresaId],
        ];
  const [r] = await pool.query<any>(sql, params);
  if (!r.affectedRows) throw new Conflito(acao === 'desfazer' ? 'O lançamento já está pendente.' : 'O lançamento não está pendente (já foi conciliado ou ignorado).');
}

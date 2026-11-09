/**
 * Remessa CNAB: junta os boletos emitidos e as instruções pendentes da conta
 * num arquivo, numa transação só. Se o arquivo não fecha (campo que não cabe,
 * cadastro incompleto), nada muda: nem o número da remessa é gasto.
 */
import { pool } from '../db.js';
import { agora, dataHoraMysql } from './datas.js';
import { boletoDaLinha, Conflito, reservar } from './boletos.js';
import { carregarConta } from './contas.js';
import { ItemRemessa } from './tipos.js';

export async function gerarRemessa(empresaId: number, contaId: number, usuarioId: number | null) {
  const { conta, modulo } = await carregarConta(empresaId, contaId);
  if (conta.layoutCnab !== '240') {
    throw new Error(conta.layoutCnab ? `Layout CNAB ${conta.layoutCnab} ainda não implementado: use 240.` : 'Esta conta não gera remessa (layout CNAB vazio).');
  }
  const problemas = modulo.validarConta(conta);
  if (problemas.length) throw new Error(`Cadastro da conta incompleto: ${problemas.join(' ')}`);

  const con = await pool.getConnection();
  try {
    await con.beginTransaction();
    const momento = dataHoraMysql();
    const numero = await reservar(conta.id, 'ultima_remessa', con);
    const nome = `REM${conta.bancoCodigo}${String(numero).padStart(6, '0')}.rem`;
    const [r] = await con.query<any>(
      `INSERT INTO ban_remessas (empresa_id, conta_id, numero, layout, nome_arquivo, conteudo, situacao, usuario_id, criado_em)
       VALUES (?, ?, ?, '240', ?, '', 'gerada', ?, ?)`,
      [empresaId, conta.id, numero, nome, usuarioId, momento],
    );
    const remessaId = r.insertId;

    // Marca o que vai neste arquivo: quem gerar outra remessa ao mesmo tempo espera e não pega os mesmos
    await con.query(
      "UPDATE ban_boletos SET remessa_id = ? WHERE conta_id = ? AND canal = 'remessa' AND situacao = 'emitido' AND remessa_id IS NULL",
      [remessaId, conta.id],
    );
    await con.query(
      `UPDATE ban_instrucoes i JOIN ban_boletos b ON b.id = i.boleto_id
          SET i.remessa_id = ?
        WHERE b.conta_id = ? AND i.canal = 'remessa' AND i.situacao = 'pendente' AND i.remessa_id IS NULL`,
      [remessaId, conta.id],
    );

    const [boletos] = await con.query<any[]>('SELECT * FROM ban_boletos WHERE remessa_id = ? ORDER BY id', [remessaId]);
    const [instrucoes] = await con.query<any[]>(
      `SELECT i.tipo, i.dados AS dados_instrucao, b.* FROM ban_instrucoes i JOIN ban_boletos b ON b.id = i.boleto_id
        WHERE i.remessa_id = ? ORDER BY i.id`,
      [remessaId],
    );
    if (!boletos.length && !instrucoes.length) throw new Conflito('Nada pendente para esta conta: nenhum boleto emitido nem instrução aguardando remessa.');

    const json = (v: any) => (typeof v === 'string' ? JSON.parse(v) : v || {});
    const itens: ItemRemessa[] = [
      ...boletos.map((b) => ({ comando: 'registrar' as const, boleto: boletoDaLinha({ ...b, dados: json(b.dados) }) })),
      ...instrucoes.map((i) => ({ comando: i.tipo, boleto: boletoDaLinha({ ...i, dados: json(i.dados) }), dados: json(i.dados_instrucao) })),
    ];
    const conteudo = modulo.cnab240.remessa(conta, numero, itens, agora());
    const valorTotal = boletos.reduce((s, b) => s + Number(b.valor), 0);

    await con.query('UPDATE ban_remessas SET conteudo = ?, qtde_registros = ?, valor_total = ? WHERE id = ?', [
      conteudo, itens.length, Math.round(valorTotal * 100) / 100, remessaId,
    ]);
    await con.query("UPDATE ban_boletos SET situacao = 'enviado', atualizado_em = ? WHERE remessa_id = ?", [momento, remessaId]);
    await con.query("UPDATE ban_instrucoes SET situacao = 'enviada', atualizado_em = ? WHERE remessa_id = ?", [momento, remessaId]);
    await con.commit();
    return { id: remessaId, numero, nome, boletos: boletos.length, instrucoes: instrucoes.length, valorTotal };
  } catch (err) {
    await con.rollback();
    throw err;
  } finally {
    con.release();
  }
}

/** O arquivo foi entregue ao banco (o usuário baixou e subiu no internet banking) */
export async function marcarRemessaEnviada(empresaId: number, id: number) {
  const [r] = await pool.query<any>(
    "UPDATE ban_remessas SET situacao = 'enviada', atualizado_em = ? WHERE id = ? AND empresa_id = ? AND situacao = 'gerada'",
    [dataHoraMysql(), id, empresaId],
  );
  if (!r.affectedRows) throw new Conflito('Só remessa gerada pode ser marcada como enviada.');
}

/**
 * Remessa gerada e ainda não entregue: os boletos e instruções voltam para a
 * fila da próxima. O número dela fica gasto (o banco aceita pular NSA).
 */
export async function cancelarRemessa(empresaId: number, id: number) {
  const con = await pool.getConnection();
  try {
    await con.beginTransaction();
    const [r] = await con.query<any>(
      "UPDATE ban_remessas SET situacao = 'cancelada', atualizado_em = ? WHERE id = ? AND empresa_id = ? AND situacao = 'gerada'",
      [dataHoraMysql(), id, empresaId],
    );
    if (!r.affectedRows) throw new Conflito('Só remessa gerada (ainda não enviada ao banco) pode ser cancelada.');
    await con.query("UPDATE ban_boletos SET situacao = 'emitido', remessa_id = NULL WHERE remessa_id = ? AND situacao = 'enviado'", [id]);
    await con.query("UPDATE ban_instrucoes SET situacao = 'pendente', remessa_id = NULL WHERE remessa_id = ? AND situacao = 'enviada'", [id]);
    await con.commit();
  } catch (err) {
    await con.rollback();
    throw err;
  } finally {
    con.release();
  }
}

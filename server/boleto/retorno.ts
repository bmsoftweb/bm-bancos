/**
 * Retorno: arquivo CNAB importado ou movimento consultado na API. Os dois
 * viram ban_ocorrencias pelo mesmo caminho (registrarOcorrencia), e a chave de
 * deduplicação impede contar duas vezes a liquidação que chega pelos dois.
 */
import crypto from 'crypto';
import { pool } from '../db.js';
import { dataHoraMysql, dataISO, somarDias } from './datas.js';
import { Conflito, registrarOcorrencia } from './boletos.js';
import { carregarConta, clienteDaConta, linhaParaConta, SELECT_CONTA } from './contas.js';
import { linhas } from './cnab.js';
import { Ocorrencia } from './tipos.js';

type Resumo = { novas: number; repetidas: number; semBoleto: number; porTipo: Record<string, number> };

const resumoVazio = (): Resumo => ({ novas: 0, repetidas: 0, semBoleto: 0, porTipo: {} });

function contar(r: Resumo, o: Ocorrencia, resultado: 'nova' | 'repetida' | 'sem_boleto') {
  if (resultado === 'repetida') r.repetidas++;
  else {
    r.novas++;
    if (resultado === 'sem_boleto') r.semBoleto++;
    r.porTipo[o.tipo] = (r.porTipo[o.tipo] || 0) + 1;
  }
}

export async function importarRetorno(empresaId: number, contaId: number, nomeArquivo: string, conteudo: string, usuarioId: number | null) {
  const { conta, modulo } = await carregarConta(empresaId, contaId);
  const registros = linhas(conteudo);
  if (!registros.length) throw new Error('Arquivo de retorno vazio.');
  const tamanho = registros[0].length;
  if (tamanho !== 240) throw new Error(tamanho === 400 ? 'Retorno CNAB 400 ainda não implementado: peça ao banco o retorno em 240.' : `Arquivo com linhas de ${tamanho} posições: não é um retorno CNAB 240.`);
  if (registros[0].slice(0, 3) !== conta.bancoCodigo) throw new Error(`O arquivo é do banco ${registros[0].slice(0, 3)}, não do banco da conta (${conta.bancoCodigo}).`);

  const hash = crypto.createHash('sha256').update(conteudo).digest('hex');
  const [ja] = await pool.query<any[]>('SELECT id, criado_em FROM ban_retornos WHERE conta_id = ? AND hash = ? LIMIT 1', [conta.id, hash]);
  if (ja.length) throw new Conflito(`Este arquivo já foi importado em ${String(ja[0].criado_em).slice(8, 10)}/${String(ja[0].criado_em).slice(5, 7)}/${String(ja[0].criado_em).slice(0, 4)}.`);

  const retorno = modulo.cnab240.retorno(conteudo, conta);
  const resumo = resumoVazio();

  const con = await pool.getConnection();
  try {
    await con.beginTransaction();
    const [r] = await con.query<any>(
      `INSERT INTO ban_retornos (empresa_id, conta_id, numero, layout, nome_arquivo, data_arquivo, hash, qtde_registros, conteudo, usuario_id, criado_em)
       VALUES (?, ?, ?, '240', ?, ?, ?, ?, ?, ?, ?)`,
      [empresaId, conta.id, retorno.numero ?? null, String(nomeArquivo || 'retorno.ret').slice(0, 120), retorno.dataArquivo || null, hash,
        retorno.ocorrencias.length, conteudo, usuarioId, dataHoraMysql()],
    );
    for (const o of retorno.ocorrencias) contar(resumo, o, await registrarOcorrencia(con, conta, o, 'arquivo', r.insertId));
    await con.commit();
    return { id: r.insertId, numero: retorno.numero ?? null, ...resumo };
  } catch (err: any) {
    await con.rollback();
    if (err?.code === 'ER_DUP_ENTRY' && /hash/.test(err.sqlMessage || '')) throw new Conflito('Este arquivo já foi importado.');
    throw err;
  } finally {
    con.release();
  }
}

/**
 * Liquidações e baixas pela API, do último dia consultado até hoje (repete um
 * dia para trás: a deduplicação descarta o que já veio).
 */
export async function buscarMovimentoApi(empresaId: number, contaId: number) {
  const { conta, modulo } = await carregarConta(empresaId, contaId);
  const [[linha]] = await pool.query<any[]>('SELECT api_consultado_ate FROM ban_contas WHERE id = ?', [conta.id]);
  const hoje = dataISO();
  const de = linha?.api_consultado_ate ? somarDias(String(linha.api_consultado_ate).slice(0, 10), -1) : somarDias(hoje, -5);
  const cli = await clienteDaConta(conta);
  const ocorrencias = await modulo.api.movimento(cli, conta, de, hoje);

  const resumo = resumoVazio();
  for (const o of ocorrencias) contar(resumo, o, await registrarOcorrencia(pool, conta, o, 'api', null));
  await pool.query('UPDATE ban_contas SET api_consultado_ate = ? WHERE id = ?', [dataHoraMysql(), conta.id]);
  return { de, ate: hoje, ...resumo };
}

/**
 * Busca automática do movimento nas contas do canal API, a cada 30 minutos,
 * das 7h às 22h. Só no servidor contínuo (server.ts): na Vercel não há processo vivo.
 * ponytail: uma conta por vez num laço só; filas por banco se o número de contas crescer
 */
export function agendarMovimentoApi() {
  const rodar = async () => {
    const hora = new Date(Date.now() - 3 * 3600_000).getUTCHours();
    if (hora < 7 || hora >= 22) return;
    try {
      const [contas] = await pool.query<any[]>(
        `${SELECT_CONTA} JOIN ban_credenciais k ON k.conta_id = c.id WHERE c.ativo = 1 AND c.canal = 'api' AND k.client_id IS NOT NULL`,
      );
      for (const c of contas) {
        const conta = linhaParaConta(c);
        try {
          await buscarMovimentoApi(conta.empresaId, conta.id);
        } catch (err: any) {
          console.error(`Movimento da conta ${conta.id}:`, err?.message);
        }
      }
    } catch (err: any) {
      // Tabelas ainda não criadas etc.: tenta de novo na próxima volta
      console.error('Movimento API:', err?.message);
    }
  };
  setInterval(rodar, 30 * 60_000).unref();
}

/**
 * Boletos: emissão, registro pela API, instruções e ocorrências.
 *
 * A referência do módulo ("CR-123") é a idempotência, como no BMNFe: mandar a
 * mesma de novo nunca cria outro boleto. O nosso número fica preso a ela, e
 * qualquer reenvio de algo que já foi ao banco começa por uma consulta: se o
 * banco já registrou (resposta perdida), o boleto é recuperado em vez de
 * registrado duas vezes.
 */
import crypto from 'crypto';
import type { PoolConnection } from 'mysql2/promise';
import { pool } from '../db.js';
import { agora, dataHoraMysql, dataISO, somarDias } from './datas.js';
import { carregarConta, clienteDaConta } from './contas.js';
import { barrasDaLinha, codigoBarras, digitos, linhaDigitavel } from './febraban.js';
import { FalhaComunicacao } from './http.js';
import { Boleto, Comando, Conta, DadosComando, ModuloBanco, Ocorrencia, Pagador, ResultadoRegistro } from './tipos.js';

/** Vira 409 na rota: a operação não cabe no estado atual, tente depois ou use outra referência */
export class Conflito extends Error {}

/** Registro pela API parado há mais que isso é tratado como "enviado": consulta antes de reenviar */
const TRAVA_MS = 2 * 60 * 1000;

export const COMANDOS: Exclude<Comando, 'registrar'>[] = [
  'baixar', 'alterar_vencimento', 'alterar_valor', 'conceder_abatimento', 'cancelar_abatimento', 'protestar', 'sustar_protesto',
];

type Executor = Pick<PoolConnection, 'query'>;

// ---------------------------------------------------------------------------
// Validação do pedido
// ---------------------------------------------------------------------------

export interface PedidoBoleto {
  referencia?: string | null;
  contaId: number;
  seuNumero?: string;
  dataEmissao?: string;
  dataVencimento: string;
  valor: number;
  pagador: Pagador;
  especie?: string;
  aceite?: 'A' | 'N';
  /** Omitido = padrão da conta; null = sem multa */
  multa?: { percentual: number; data?: string } | null;
  /** Omitido = padrão da conta; null = sem juros */
  juros?: { percentualMensal: number; data?: string } | null;
  desconto?: { valor: number; data: string } | null;
  abatimento?: number;
  diasProtesto?: number;
  diasBaixa?: number;
  mensagens?: string[];
  pixHibrido?: boolean;
  canal?: 'remessa' | 'api';
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function dataValida(v: unknown, nome: string): string {
  const s = String(v ?? '').slice(0, 10);
  if (!ISO.test(s)) throw new Error(`${nome} inválida: informe no formato AAAA-MM-DD.`);
  const [a, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(a, m - 1, d));
  if (t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) throw new Error(`${nome} inexistente: ${s}.`);
  return s;
}

const reais = (v: unknown) => Math.round(Number(v) * 100) / 100;

export function cpfValido(c: string): boolean {
  if (!/^\d{11}$/.test(c) || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(c[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
}

export function cnpjValido(c: string): boolean {
  if (!/^\d{14}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false;
  const dv = (n: number) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = pesos.reduce((s, p, i) => s + Number(c[i]) * p, 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(c[12]) && dv(13) === Number(c[13]);
}

function normalizarReferencia(r: unknown): string | null {
  const s = String(r ?? '').trim();
  if (!s) return null;
  if (s.length > 80) throw new Error('Referência maior que 80 caracteres.');
  if (!/^[\w.\-/:#]+$/.test(s)) throw new Error('Referência só pode ter letras, números e . - _ / : #');
  return s;
}

/** Pedido validado e completado com os padrões da conta (ainda sem nosso número) */
function montarBoleto(p: PedidoBoleto, conta: Conta, hoje: string) {
  const dataEmissao = p.dataEmissao ? dataValida(p.dataEmissao, 'Data de emissão') : hoje;
  const dataVencimento = dataValida(p.dataVencimento, 'Vencimento');
  if (dataVencimento < dataEmissao) throw new Error('O vencimento não pode ser anterior à emissão.');

  const valor = reais(p.valor);
  if (!(valor > 0)) throw new Error('Informe o valor do boleto.');
  if (valor > 99_999_999.99) throw new Error('Valor acima do limite do boleto.');

  const g = p.pagador || ({} as Pagador);
  const documento = digitos(g.documento);
  if (!(documento.length === 11 ? cpfValido(documento) : cnpjValido(documento))) throw new Error(`CPF/CNPJ do pagador inválido: ${g.documento || '(vazio)'}.`);
  const cep = digitos(g.cep);
  const faltando = [
    !String(g.nome || '').trim() && 'nome',
    !String(g.logradouro || '').trim() && 'logradouro',
    !String(g.bairro || '').trim() && 'bairro',
    !String(g.cidade || '').trim() && 'cidade',
    !/^[A-Za-z]{2}$/.test(String(g.uf || '').trim()) && 'UF',
    cep.length !== 8 && 'CEP (8 dígitos)',
  ].filter(Boolean);
  if (faltando.length) throw new Error(`Dados do pagador incompletos: ${faltando.join(', ')}.`);
  const pagador: Pagador = {
    documento,
    nome: String(g.nome).trim(),
    logradouro: String(g.logradouro).trim(),
    numero: String(g.numero ?? '').trim(),
    complemento: String(g.complemento ?? '').trim(),
    bairro: String(g.bairro).trim(),
    cidade: String(g.cidade).trim(),
    uf: String(g.uf).trim().toUpperCase(),
    cep,
    email: String(g.email ?? '').trim() || undefined,
  };

  const cfg = conta.config;
  const diaSeguinte = somarDias(dataVencimento, 1);

  let multa: Boleto['multa'];
  if (p.multa === undefined) {
    if (Number(cfg.multaPercentual) > 0) multa = { percentual: Number(cfg.multaPercentual), data: diaSeguinte };
  } else if (p.multa && Number(p.multa.percentual) > 0) {
    multa = { percentual: Number(p.multa.percentual), data: p.multa.data ? dataValida(p.multa.data, 'Data da multa') : diaSeguinte };
  }
  if (multa && multa.percentual > 2) throw new Error('Multa acima de 2% (limite do Código de Defesa do Consumidor).');

  let juros: Boleto['juros'];
  if (p.juros === undefined) {
    if (Number(cfg.jurosMensalPercentual) > 0) juros = { percentualMensal: Number(cfg.jurosMensalPercentual), data: diaSeguinte };
  } else if (p.juros && Number(p.juros.percentualMensal) > 0) {
    juros = { percentualMensal: Number(p.juros.percentualMensal), data: p.juros.data ? dataValida(p.juros.data, 'Data dos juros') : diaSeguinte };
  }

  let desconto: Boleto['desconto'];
  if (p.desconto && Number(p.desconto.valor) > 0) {
    desconto = { valor: reais(p.desconto.valor), data: dataValida(p.desconto.data, 'Data limite do desconto') };
    if (desconto.valor >= valor) throw new Error('O desconto precisa ser menor que o valor do boleto.');
    if (desconto.data > dataVencimento) throw new Error('A data limite do desconto não pode passar do vencimento.');
  }

  const abatimento = reais(p.abatimento ?? 0) || undefined;
  if (abatimento && abatimento >= valor) throw new Error('O abatimento precisa ser menor que o valor do boleto.');

  const mensagens = (p.mensagens || []).map((m) => String(m).trim()).filter(Boolean);
  if (mensagens.length > 4) throw new Error('No máximo 4 linhas de mensagem.');

  const seuNumero = String(p.seuNumero ?? '').trim();
  if (seuNumero.length > 15) throw new Error('Seu número (número do documento) com mais de 15 posições.');

  const canal = p.canal || conta.canal;
  if (canal !== 'api' && canal !== 'remessa') throw new Error('Canal deve ser "remessa" ou "api".');
  if (canal === 'remessa' && !conta.layoutCnab) throw new Error('Esta conta não gera remessa (layout CNAB vazio): use o canal "api".');

  return {
    canal,
    seuNumero,
    dataEmissao,
    dataVencimento,
    valor,
    pagador,
    especie: String(p.especie || cfg.especie || 'DM').toUpperCase(),
    aceite: (p.aceite || cfg.aceite || 'N') as 'A' | 'N',
    multa,
    juros,
    desconto,
    abatimento,
    diasProtesto: p.diasProtesto ?? cfg.diasProtesto,
    diasBaixa: p.diasBaixa ?? cfg.diasBaixa,
    mensagens,
    pixHibrido: p.pixHibrido ?? !!cfg.pixHibrido,
  };
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

export async function buscarBoleto(empresaId: number, id: number, ex: Executor = pool): Promise<any> {
  const [l] = await ex.query<any[]>('SELECT * FROM ban_boletos WHERE id = ? AND empresa_id = ? LIMIT 1', [id, empresaId]);
  if (!l.length) throw new Error(`Boleto ${id} não encontrado.`);
  return comDados(l[0]);
}

export async function boletoPorReferencia(empresaId: number, referencia: string): Promise<any | null> {
  const [l] = await pool.query<any[]>('SELECT * FROM ban_boletos WHERE empresa_id = ? AND referencia = ? LIMIT 1', [empresaId, referencia]);
  return l.length ? comDados(l[0]) : null;
}

const comDados = (l: any) => ({ ...l, dados: typeof l.dados === 'string' ? JSON.parse(l.dados) : l.dados });

/** Linha de ban_boletos -> Boleto do contrato (as colunas valem mais que o JSON) */
export function boletoDaLinha(l: any): Boleto {
  const d = l.dados || {};
  return {
    ...d,
    nossoNumero: l.nosso_numero || '',
    nossoNumeroDv: l.nosso_numero_dv || '',
    seuNumero: l.seu_numero,
    dataEmissao: String(l.data_emissao).slice(0, 10),
    dataVencimento: String(l.data_vencimento).slice(0, 10),
    valor: Number(l.valor),
  };
}

// ---------------------------------------------------------------------------
// Numeração
// ---------------------------------------------------------------------------

/**
 * Próximo número do contador da conta, com LAST_INSERT_ID(expr): um comando só,
 * sem transação; duas chamadas simultâneas nunca recebem o mesmo número.
 */
export async function reservar(contaId: number, coluna: 'ultimo_nosso_numero' | 'ultima_remessa', con?: PoolConnection): Promise<number> {
  const c = con || (await pool.getConnection());
  try {
    await c.query(`UPDATE ban_contas SET ${coluna} = LAST_INSERT_ID(${coluna} + 1) WHERE id = ?`, [contaId]);
    const [[l]] = await c.query<any[]>('SELECT LAST_INSERT_ID() AS n');
    return Number(l.n);
  } finally {
    if (!con) c.release();
  }
}

function codigos(conta: Conta, modulo: ModuloBanco, nn: string, dv: string, vencimento: string, valor: number) {
  const barras = codigoBarras(conta.bancoCodigo, vencimento, valor, modulo.campoLivre(conta, nn, dv));
  return { barras, linha: linhaDigitavel(barras) };
}

// ---------------------------------------------------------------------------
// Emissão
// ---------------------------------------------------------------------------

export interface ResultadoEmissao {
  boleto: any;
  /** A referência já existia: devolveu (ou continuou) o boleto dela */
  repetida: boolean;
}

export async function emitir(empresaId: number, p: PedidoBoleto, opcoes: { registrar?: boolean } = {}): Promise<ResultadoEmissao> {
  const { conta, modulo, ativa } = await carregarConta(empresaId, Number(p.contaId));
  if (!ativa) throw new Error('Esta conta de cobrança está inativa.');
  const problemas = modulo.validarConta(conta);
  if (problemas.length) throw new Error(`Cadastro da conta incompleto: ${problemas.join(' ')}`);

  const referencia = normalizarReferencia(p.referencia);
  if (referencia) {
    const existente = await boletoPorReferencia(empresaId, referencia);
    if (existente) return { boleto: await continuar(empresaId, existente, p, conta, modulo, opcoes), repetida: true };
  }

  const base = montarBoleto(p, conta, dataISO());
  const seq = await reservar(conta.id, 'ultimo_nosso_numero');
  const nn = modulo.nossoNumero(conta, seq);
  const boleto: Boleto = { ...base, nossoNumero: nn.numero, nossoNumeroDv: nn.dv, seuNumero: base.seuNumero || String(seq) };
  const { barras, linha } = codigos(conta, modulo, nn.numero, nn.dv, boleto.dataVencimento, boleto.valor);
  const { canal, ...dados } = { ...base, seuNumero: boleto.seuNumero };
  const momento = dataHoraMysql();

  let id: number;
  try {
    const [r] = await pool.query<any>(
      `INSERT INTO ban_boletos
         (empresa_id, conta_id, referencia, ambiente, canal, situacao, nosso_numero, nosso_numero_dv, seu_numero,
          data_emissao, data_vencimento, valor, pagador_documento, pagador_nome, codigo_barras, linha_digitavel, dados, criado_em)
       VALUES (?, ?, ?, ?, ?, 'emitido', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        empresaId, conta.id, referencia, conta.ambiente, canal, nn.numero, nn.dv, boleto.seuNumero,
        boleto.dataEmissao, boleto.dataVencimento, boleto.valor, boleto.pagador.documento, boleto.pagador.nome.slice(0, 100),
        barras, linha, JSON.stringify(dados), momento,
      ],
    );
    id = r.insertId;
  } catch (err: any) {
    // Outra chamada com a mesma referência gravou primeiro: segue com a dela.
    // O nosso número reservado aqui fica sem uso (buraco não é problema em boleto).
    if (err?.code === 'ER_DUP_ENTRY' && referencia && /referencia/.test(err.sqlMessage || '')) {
      const existente = await boletoPorReferencia(empresaId, referencia);
      if (existente) return { boleto: await continuar(empresaId, existente, p, conta, modulo, opcoes), repetida: true };
    }
    throw err;
  }

  if (canal === 'api' && opcoes.registrar !== false) return { boleto: await registrarNaApi(empresaId, id), repetida: false };
  return { boleto: await buscarBoleto(empresaId, id), repetida: false };
}

/** Mesma referência de novo: o que fazer depende de onde o boleto parou */
async function continuar(empresaId: number, b: any, p: PedidoBoleto, conta: Conta, modulo: ModuloBanco, opcoes: { registrar?: boolean }) {
  if (Number(b.conta_id) !== conta.id) throw new Conflito(`A referência ${b.referencia} já foi usada num boleto de outra conta.`);

  switch (b.situacao) {
    case 'registrado':
    case 'liquidado':
    case 'baixado':
      return b;
    case 'cancelado':
      throw new Conflito(`A referência ${b.referencia} pertence a um boleto cancelado: use outra referência.`);
    case 'processando':
      if (Date.now() - horaMysql(b.atualizado_em || b.criado_em) < TRAVA_MS) {
        throw new Conflito('O registro deste boleto está em andamento. Consulte pela referência em instantes.');
      }
      return registrarNaApi(empresaId, b.id);
    case 'enviado':
      // Pela remessa, espera o retorno; pela API, consulta e completa
      return b.canal === 'api' && opcoes.registrar !== false ? registrarNaApi(empresaId, b.id) : b;
    case 'emitido':
    case 'rejeitado': {
      // Ainda não vale no banco: aceita os dados novos com o mesmo nosso número
      await atualizarDados(empresaId, b, montarBoleto({ ...p, canal: b.canal }, conta, dataISO()), conta, modulo);
      if (b.situacao === 'rejeitado' && b.canal === 'remessa') {
        await pool.query("UPDATE ban_boletos SET situacao = 'emitido', remessa_id = NULL WHERE id = ?", [b.id]);
      }
      if (b.canal === 'api' && opcoes.registrar !== false) return registrarNaApi(empresaId, b.id);
      return buscarBoleto(empresaId, b.id);
    }
    default:
      return b;
  }
}

/** "2026-11-08 14:00:00" (Brasília) -> ms, comparável com Date.now() */
function horaMysql(s: string): number {
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return 0;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] + 3, +m[5], +m[6]);
}

async function atualizarDados(empresaId: number, b: any, novo: ReturnType<typeof montarBoleto>, conta: Conta, modulo: ModuloBanco) {
  const { canal: _c, ...dados } = { ...novo, seuNumero: novo.seuNumero || b.seu_numero };
  const { barras, linha } = codigos(conta, modulo, b.nosso_numero, b.nosso_numero_dv, novo.dataVencimento, novo.valor);
  await pool.query(
    `UPDATE ban_boletos SET seu_numero = ?, data_emissao = ?, data_vencimento = ?, valor = ?, pagador_documento = ?, pagador_nome = ?,
            codigo_barras = ?, linha_digitavel = ?, dados = ?, atualizado_em = ? WHERE id = ? AND empresa_id = ?`,
    [
      dados.seuNumero, novo.dataEmissao, novo.dataVencimento, novo.valor, novo.pagador.documento, novo.pagador.nome.slice(0, 100),
      barras, linha, JSON.stringify(dados), dataHoraMysql(), b.id, empresaId,
    ],
  );
}

// ---------------------------------------------------------------------------
// Registro pela API
// ---------------------------------------------------------------------------

/**
 * Registra no banco. Recusa do banco deixa o boleto "rejeitado" com o motivo;
 * falha de rede deixa "enviado" (pode ter chegado). Nos dois casos devolve a
 * linha atualizada em vez de lançar: quem chama decide como mostrar.
 */
export async function registrarNaApi(empresaId: number, id: number): Promise<any> {
  const b = await buscarBoleto(empresaId, id);
  if (b.canal !== 'api') throw new Error('Este boleto é do canal remessa: ele vai ao banco na próxima remessa.');
  const { conta, modulo } = await carregarConta(empresaId, b.conta_id);
  // Sem credencial não trava nada: o erro sai antes
  const cli = await clienteDaConta(conta, b.referencia);

  const limite = dataHoraMysql(new Date(agora().getTime() - TRAVA_MS));
  const [trava] = await pool.query<any>(
    `UPDATE ban_boletos SET situacao = 'processando', atualizado_em = ?
      WHERE id = ? AND (situacao IN ('emitido', 'rejeitado', 'enviado') OR (situacao = 'processando' AND atualizado_em < ?))`,
    [dataHoraMysql(), id, limite],
  );
  if (!trava.affectedRows) {
    const atual = await buscarBoleto(empresaId, id);
    if (atual.situacao === 'processando') throw new Conflito('O registro deste boleto já está em andamento.');
    return atual;
  }

  const boleto = boletoDaLinha(b);
  try {
    // Já esteve no banco antes (rejeitado, enviado, travado): pergunta antes de reenviar
    if (b.situacao !== 'emitido') {
      const c = await modulo.api.consultar(cli, conta, boleto);
      if (c.registrado) {
        await marcarRegistrado(empresaId, b, conta, modulo, c.resultado);
        return buscarBoleto(empresaId, id);
      }
    }
    const r = await modulo.api.registrar(cli, conta, boleto);
    await marcarRegistrado(empresaId, b, conta, modulo, r);
  } catch (err: any) {
    const motivo = String(err?.message || err).slice(0, 500);
    if (err instanceof FalhaComunicacao) {
      await pool.query("UPDATE ban_boletos SET situacao = 'enviado', motivo = ?, atualizado_em = ? WHERE id = ?", [motivo, dataHoraMysql(), id]);
    } else {
      await pool.query("UPDATE ban_boletos SET situacao = 'rejeitado', motivo = ?, atualizado_em = ? WHERE id = ?", [motivo, dataHoraMysql(), id]);
      await registrarOcorrencia(pool, conta, {
        nossoNumero: b.nosso_numero, tipo: 'rejeicao', codigoBanco: 'API', motivo, dataOcorrencia: dataISO(),
      }, 'api', null);
    }
  }
  return buscarBoleto(empresaId, id);
}

async function marcarRegistrado(empresaId: number, b: any, conta: Conta, modulo: ModuloBanco, r?: ResultadoRegistro) {
  const nn = r?.nossoNumero || b.nosso_numero;
  const dv = r?.nossoNumeroDv ?? b.nosso_numero_dv;
  // Os códigos que o banco devolve valem mais que os calculados aqui
  let barras = digitos(r?.codigoBarras);
  if (barras.length !== 44 && digitos(r?.linhaDigitavel).length === 47) barras = barrasDaLinha(r!.linhaDigitavel!);
  if (barras.length !== 44) barras = codigos(conta, modulo, nn, dv, String(b.data_vencimento).slice(0, 10), Number(b.valor)).barras;

  await pool.query(
    `UPDATE ban_boletos SET nosso_numero = ?, nosso_numero_dv = ?, codigo_barras = ?, linha_digitavel = ?,
            pix_emv = COALESCE(?, pix_emv), codigo_status = NULL, motivo = NULL, atualizado_em = ?
      WHERE id = ? AND empresa_id = ?`,
    [nn, dv, barras, linhaDigitavel(barras), r?.pixEmv || null, dataHoraMysql(), b.id, empresaId],
  );
  await registrarOcorrencia(pool, conta, { nossoNumero: nn, tipo: 'entrada', codigoBanco: 'API', motivo: 'Registrado pela API', dataOcorrencia: dataISO() }, 'api', null);
}

// ---------------------------------------------------------------------------
// Instruções
// ---------------------------------------------------------------------------

/**
 * Pedido ao banco sobre um boleto. Enquanto o boleto não foi ao banco, a
 * mudança é só local (baixar = cancelar). Pela API vai na hora; pela remessa
 * fica pendente para a próxima. Vencimento e valor novos valem na hora para a
 * reimpressão; se o banco recusar, o motivo fica na instrução.
 */
export async function instruir(empresaId: number, boletoId: number, comando: string, dados: DadosComando = {}, usuarioId: number | null = null) {
  if (!COMANDOS.includes(comando as any)) throw new Error(`Instrução desconhecida: ${comando}.`);
  const tipo = comando as Exclude<Comando, 'registrar'>;
  const b = await buscarBoleto(empresaId, boletoId);
  const { conta, modulo } = await carregarConta(empresaId, b.conta_id);

  if (['liquidado', 'baixado', 'cancelado'].includes(b.situacao)) throw new Conflito(`O boleto está ${b.situacao}: não aceita instruções.`);
  if (b.situacao === 'processando') throw new Conflito('O registro deste boleto está em andamento. Tente em instantes.');

  // Validação dos dados
  const hoje = dataISO();
  let novoVenc: string | undefined;
  let novoValor: number | undefined;
  if (tipo === 'alterar_vencimento') {
    novoVenc = dataValida(dados.vencimento, 'Novo vencimento');
    if (novoVenc < hoje) throw new Error('O novo vencimento não pode ser anterior a hoje.');
  }
  if (tipo === 'alterar_valor') {
    novoValor = reais(dados.valor);
    if (!(novoValor > 0)) throw new Error('Informe o novo valor.');
  }
  if (tipo === 'conceder_abatimento') {
    const ab = reais(dados.abatimento);
    if (!(ab > 0) || ab >= Number(b.valor)) throw new Error('O abatimento precisa ser maior que zero e menor que o valor do boleto.');
    dados = { abatimento: ab };
  }

  // Ainda não foi ao banco: muda só aqui
  if (b.situacao === 'emitido' || b.situacao === 'rejeitado') {
    if (tipo === 'baixar') {
      await pool.query("UPDATE ban_boletos SET situacao = 'cancelado', remessa_id = NULL, atualizado_em = ? WHERE id = ?", [dataHoraMysql(), b.id]);
      return { local: true, boleto: await buscarBoleto(empresaId, b.id) };
    }
    if (tipo === 'protestar' || tipo === 'sustar_protesto') throw new Error('O boleto ainda não foi registrado no banco.');
    await aplicarLocal(empresaId, b, conta, modulo, tipo, novoVenc, novoValor, dados);
    return { local: true, boleto: await buscarBoleto(empresaId, b.id) };
  }

  // Mesma instrução ainda em andamento: devolve a que existe
  const [abertas] = await pool.query<any[]>(
    "SELECT * FROM ban_instrucoes WHERE boleto_id = ? AND tipo = ? AND situacao IN ('pendente', 'enviada') ORDER BY id DESC LIMIT 1",
    [b.id, tipo],
  );
  if (abertas.length && JSON.stringify(abertas[0].dados ? (typeof abertas[0].dados === 'string' ? JSON.parse(abertas[0].dados) : abertas[0].dados) : {}) === JSON.stringify(dados || {})) {
    return { local: false, instrucao: abertas[0], boleto: b };
  }

  const momento = dataHoraMysql();
  if (b.canal === 'api') {
    const cli = await clienteDaConta(conta, b.referencia);
    try {
      await modulo.api.instruir(cli, conta, boletoDaLinha(b), tipo, dados);
    } catch (err: any) {
      const motivo = String(err?.message || err).slice(0, 500);
      await pool.query(
        `INSERT INTO ban_instrucoes (empresa_id, boleto_id, tipo, dados, canal, situacao, motivo, usuario_id, criado_em)
         VALUES (?, ?, ?, ?, 'api', 'rejeitada', ?, ?, ?)`,
        [empresaId, b.id, tipo, JSON.stringify(dados), motivo, usuarioId, momento],
      );
      throw new Error(motivo);
    }
    const [r] = await pool.query<any>(
      `INSERT INTO ban_instrucoes (empresa_id, boleto_id, tipo, dados, canal, situacao, usuario_id, criado_em)
       VALUES (?, ?, ?, ?, 'api', 'confirmada', ?, ?)`,
      [empresaId, b.id, tipo, JSON.stringify(dados), usuarioId, momento],
    );
    if (tipo === 'baixar') {
      await registrarOcorrencia(pool, conta, { nossoNumero: b.nosso_numero, tipo: 'baixa', codigoBanco: 'API', motivo: 'Baixa pedida pela API', dataOcorrencia: dataISO() }, 'api', null);
    } else {
      await aplicarLocal(empresaId, b, conta, modulo, tipo, novoVenc, novoValor, dados);
    }
    return { local: false, instrucao: { id: r.insertId, tipo, situacao: 'confirmada' }, boleto: await buscarBoleto(empresaId, b.id) };
  }

  const [r] = await pool.query<any>(
    `INSERT INTO ban_instrucoes (empresa_id, boleto_id, tipo, dados, canal, situacao, usuario_id, criado_em)
     VALUES (?, ?, ?, ?, 'remessa', 'pendente', ?, ?)`,
    [empresaId, b.id, tipo, JSON.stringify(dados), usuarioId, momento],
  );
  if (tipo !== 'baixar') await aplicarLocal(empresaId, b, conta, modulo, tipo, novoVenc, novoValor, dados);
  return { local: false, instrucao: { id: r.insertId, tipo, situacao: 'pendente' }, boleto: await buscarBoleto(empresaId, b.id) };
}

/** Efeito da instrução no boleto gravado (vencimento, valor, abatimento) */
async function aplicarLocal(
  empresaId: number, b: any, conta: Conta, modulo: ModuloBanco, tipo: Comando, novoVenc?: string, novoValor?: number, dados: DadosComando = {},
) {
  const d = { ...(b.dados || {}) };
  const venc = novoVenc || String(b.data_vencimento).slice(0, 10);
  const valor = novoValor ?? Number(b.valor);
  if (tipo === 'conceder_abatimento') d.abatimento = dados.abatimento;
  if (tipo === 'cancelar_abatimento') delete d.abatimento;
  if (novoVenc) {
    // Multa e juros acompanham o vencimento novo
    if (d.multa) d.multa.data = somarDias(novoVenc, 1);
    if (d.juros) d.juros.data = somarDias(novoVenc, 1);
    if (d.desconto && d.desconto.data > novoVenc) delete d.desconto;
  }
  const { barras, linha } = codigos(conta, modulo, b.nosso_numero, b.nosso_numero_dv, venc, valor);
  await pool.query(
    'UPDATE ban_boletos SET data_vencimento = ?, valor = ?, codigo_barras = ?, linha_digitavel = ?, dados = ?, atualizado_em = ? WHERE id = ? AND empresa_id = ?',
    [venc, valor, barras, linha, JSON.stringify(d), dataHoraMysql(), b.id, empresaId],
  );
}

// ---------------------------------------------------------------------------
// Ocorrências (retorno, consulta, webhook)
// ---------------------------------------------------------------------------

/** Entrada, liquidação e baixa só contam uma vez, venha de onde vier */
function chaveDedup(contaId: number, o: Ocorrencia): string | null {
  if (!['entrada', 'liquidacao', 'baixa'].includes(o.tipo)) return null;
  const v = o.valorPago == null ? '' : Number(o.valorPago).toFixed(2);
  return crypto.createHash('sha256').update(`${contaId}|${o.nossoNumero}|${o.tipo}|${o.dataOcorrencia}|${v}`).digest('hex');
}

const valorOuNulo = (v: number | undefined) => (v == null || !Number.isFinite(Number(v)) ? null : reais(v));

/**
 * Grava a ocorrência e aplica no boleto. Devolve 'nova', 'repetida' (já
 * registrada antes) ou 'sem_boleto' (nosso número que não está no BMBancos).
 */
export async function registrarOcorrencia(
  ex: Executor, conta: Conta, o: Ocorrencia, origem: 'arquivo' | 'api' | 'webhook', retornoId: number | null,
): Promise<'nova' | 'repetida' | 'sem_boleto'> {
  const [bs] = await ex.query<any[]>('SELECT id, situacao FROM ban_boletos WHERE conta_id = ? AND nosso_numero = ? LIMIT 1', [conta.id, o.nossoNumero]);
  const boleto = bs[0];
  const dataOc = o.dataOcorrencia || dataISO();

  try {
    await ex.query(
      `INSERT INTO ban_ocorrencias
         (empresa_id, conta_id, boleto_id, nosso_numero, origem, retorno_id, tipo, codigo_banco, motivo, data_ocorrencia, data_credito,
          valor_titulo, valor_pago, valor_juros, valor_desconto, valor_abatimento, valor_tarifa, chave_dedup, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        conta.empresaId, conta.id, boleto?.id ?? null, String(o.nossoNumero).slice(0, 20), origem, retornoId, o.tipo,
        String(o.codigoBanco || '').slice(0, 10), String(o.motivo || '').slice(0, 500), dataOc, o.dataCredito || null,
        valorOuNulo(o.valorTitulo), valorOuNulo(o.valorPago), valorOuNulo(o.valorJuros), valorOuNulo(o.valorDesconto),
        valorOuNulo(o.valorAbatimento), valorOuNulo(o.valorTarifa), chaveDedup(conta.id, { ...o, dataOcorrencia: dataOc }), dataHoraMysql(),
      ],
    );
  } catch (err: any) {
    if (err?.code === 'ER_DUP_ENTRY') return 'repetida';
    throw err;
  }
  if (!boleto) return 'sem_boleto';

  const momento = dataHoraMysql();
  switch (o.tipo) {
    case 'entrada':
      await ex.query(
        "UPDATE ban_boletos SET situacao = 'registrado', atualizado_em = ? WHERE id = ? AND situacao IN ('emitido', 'enviado', 'processando', 'rejeitado')",
        [momento, boleto.id],
      );
      break;
    case 'rejeicao':
      await ex.query(
        `UPDATE ban_boletos SET situacao = IF(situacao IN ('emitido', 'enviado', 'processando'), 'rejeitado', situacao),
                codigo_status = ?, motivo = ?, atualizado_em = ? WHERE id = ?`,
        [String(o.codigoBanco || '').slice(0, 20), String(o.motivo || '').slice(0, 500), momento, boleto.id],
      );
      // Boleto já registrado: a recusa é de uma instrução enviada
      if (boleto.situacao === 'registrado') {
        await ex.query(
          "UPDATE ban_instrucoes SET situacao = 'rejeitada', motivo = ?, atualizado_em = ? WHERE boleto_id = ? AND situacao = 'enviada'",
          [String(o.motivo || '').slice(0, 500), momento, boleto.id],
        );
      }
      break;
    case 'liquidacao':
      await ex.query(
        `UPDATE ban_boletos SET situacao = 'liquidado', data_pagamento = ?, data_credito = ?, valor_pago = ?, atualizado_em = ?
          WHERE id = ? AND situacao <> 'liquidado'`,
        [dataOc, o.dataCredito || null, valorOuNulo(o.valorPago), momento, boleto.id],
      );
      break;
    case 'baixa':
      await ex.query("UPDATE ban_boletos SET situacao = 'baixado', atualizado_em = ? WHERE id = ? AND situacao NOT IN ('liquidado', 'cancelado')", [momento, boleto.id]);
      await ex.query(
        "UPDATE ban_instrucoes SET situacao = 'confirmada', atualizado_em = ? WHERE boleto_id = ? AND tipo = 'baixar' AND situacao IN ('pendente', 'enviada')",
        [momento, boleto.id],
      );
      break;
    case 'alteracao':
      // ponytail: confirma todas as alterações enviadas do boleto; separar por tipo se algum banco misturar confirmações
      await ex.query(
        "UPDATE ban_instrucoes SET situacao = 'confirmada', atualizado_em = ? WHERE boleto_id = ? AND tipo <> 'baixar' AND situacao = 'enviada'",
        [momento, boleto.id],
      );
      break;
    default:
      break;
  }
  return 'nova';
}

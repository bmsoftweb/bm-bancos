/**
 * Rotas /api do BMBancos. As mesmas servem a tela (token do login) e os
 * módulos do ERP (chave de API): a empresa sai sempre da credencial, nunca do
 * corpo. Cadastro de contas, credenciais e chaves só para usuário da tela.
 */
import crypto from 'crypto';
import { Request, Response, Router } from 'express';
import { pool } from '../db.js';
import { exigirUsuario, esquecerChaves, hashChave, PREFIXO_CHAVE } from '../auth.js';
import { BANCOS, moduloDoBanco } from '../bancos/index.js';
import { boletoPorReferencia, buscarBoleto, COMANDOS, Conflito, emitir, instruir, registrarNaApi } from '../boleto/boletos.js';
import { carregarConta, esquecerCertificadoConta, linhaParaConta, SELECT_CONTA } from '../boleto/contas.js';
import { carregarPfx } from '../boleto/certificado.js';
import { cifrar } from '../boleto/cripto.js';
import { dataHoraMysql } from '../boleto/datas.js';
import { formatarLinha } from '../boleto/febraban.js';
import { esquecerTokens } from '../boleto/http.js';
import { importarOfx, marcarLancamento } from '../boleto/ofx.js';
import { gerarPdf } from '../boleto/pdf.js';
import { cancelarRemessa, gerarRemessa, marcarRemessaEnviada } from '../boleto/remessa.js';
import { buscarMovimentoApi, importarRetorno } from '../boleto/retorno.js';

export function empresaDaRequisicao(req: Request): number {
  const id = req.usuario?.empresaId;
  if (!id) throw new Error('Sessão sem empresa. Entre novamente.');
  return id;
}

const usuarioId = (req: Request) => req.usuario?.id || null;

/** Exceção vira 400 com a mensagem; Conflito vira 409 */
export function rota(handler: (req: Request, res: Response) => Promise<any>) {
  return async (req: Request, res: Response) => {
    try {
      await handler(req, res);
    } catch (err: any) {
      if (res.headersSent) return;
      if (err?.code === 'ER_NO_SUCH_TABLE') {
        res.status(400).json({ success: false, error: 'Faltam tabelas do BMBancos: rode o extras/bmbancos_schema.sql no banco.' });
        return;
      }
      res.status(err instanceof Conflito ? 409 : 400).json({ success: false, error: err?.message || String(err) });
    }
  };
}

/**
 * Listagem paginada das grades: página, registros por página, busca e ordenação
 * vêm da tela, mas só por nomes da whitelist. Filtros extras por função.
 */
const paginada = (def: {
  tabela: string;
  colunas: string;
  ordenaveis: Record<string, string>;
  busca: string[];
  ordemPadrao: string;
  direcaoPadrao: 'asc' | 'desc';
  filtros?: (req: Request) => [string, unknown[]][];
}) =>
  rota(async (req, res) => {
    const porPagina = [10, 25, 50, 100, 500].includes(Number(req.query.porPagina)) ? Number(req.query.porPagina) : 25;
    const pagina = Math.max(1, Math.floor(Number(req.query.pagina) || 1));
    const ordem = def.ordenaveis[String(req.query.ordem)] || def.ordenaveis[def.ordemPadrao];
    const direcao = req.query.direcao === 'asc' ? 'ASC' : req.query.direcao === 'desc' ? 'DESC' : def.direcaoPadrao.toUpperCase();

    const condicoes: [string, unknown[]][] = [['empresa_id = ?', [empresaDaRequisicao(req)]], ...(def.filtros?.(req) || [])];
    const termo = String(req.query.busca || '').trim();
    if (termo) condicoes.push([`(${def.busca.map((c) => `${c} LIKE ?`).join(' OR ')})`, def.busca.map(() => `%${termo}%`)]);
    const onde = `WHERE ${condicoes.map(([s]) => s).join(' AND ')}`;
    const params = condicoes.flatMap(([, p]) => p);

    const [[{ total }]] = await pool.query<any[]>(`SELECT COUNT(*) AS total FROM ${def.tabela} ${onde}`, params);
    const [linhas] = await pool.query<any[]>(
      `SELECT ${def.colunas} FROM ${def.tabela} ${onde} ORDER BY ${ordem} ${direcao}, id ${direcao} LIMIT ? OFFSET ?`,
      [...params, porPagina, (pagina - 1) * porPagina],
    );
    res.json({ data: linhas, total: Number(total), totalPages: Math.max(1, Math.ceil(Number(total) / porPagina)) });
  });

/** Filtro simples por parâmetro da query, só quando ele vem preenchido */
const se = (valor: unknown, sql: string, ...params: unknown[]): [string, unknown[]][] =>
  valor !== undefined && valor !== '' ? [[sql, params.length ? params : [valor]]] : [];

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const dataQuery = (v: unknown) => (ISO.test(String(v ?? '')) ? String(v) : undefined);

/** Arquivo enviado pela tela em base64 (com ou sem o prefixo data:) */
const arquivoBase64 = (v: unknown) => {
  const b = Buffer.from(String(v || '').replace(/^data:[^,]+,/, ''), 'base64');
  if (!b.length) throw new Error('Envie o arquivo.');
  return b;
};

/** O que o módulo recebe de um boleto */
function boletoPublico(b: any) {
  return {
    id: b.id,
    referencia: b.referencia,
    contaId: b.conta_id,
    situacao: b.situacao,
    canal: b.canal,
    ambiente: b.ambiente,
    nossoNumero: b.nosso_numero,
    nossoNumeroDv: b.nosso_numero_dv,
    seuNumero: b.seu_numero,
    dataEmissao: b.data_emissao,
    dataVencimento: b.data_vencimento,
    valor: Number(b.valor),
    pagadorDocumento: b.pagador_documento,
    pagadorNome: b.pagador_nome,
    codigoBarras: b.codigo_barras,
    linhaDigitavel: b.linha_digitavel,
    linhaDigitavelFormatada: b.linha_digitavel ? formatarLinha(b.linha_digitavel) : null,
    pixCopiaECola: b.pix_emv,
    remessaId: b.remessa_id,
    dataPagamento: b.data_pagamento,
    dataCredito: b.data_credito,
    valorPago: b.valor_pago == null ? null : Number(b.valor_pago),
    codigoStatus: b.codigo_status,
    motivo: b.motivo,
    atualizadoEm: b.atualizado_em || b.criado_em,
  };
}

async function detalheBoleto(empresaId: number, b: any) {
  const [ocorrencias] = await pool.query<any[]>(
    `SELECT id, origem, tipo, codigo_banco, motivo, data_ocorrencia, data_credito, valor_pago, valor_juros, valor_desconto, valor_tarifa, criado_em
       FROM ban_ocorrencias WHERE boleto_id = ? ORDER BY id`,
    [b.id],
  );
  const [instrucoes] = await pool.query<any[]>(
    'SELECT id, tipo, dados, canal, situacao, remessa_id, motivo, criado_em, atualizado_em FROM ban_instrucoes WHERE boleto_id = ? ORDER BY id',
    [b.id],
  );
  const [[conta]] = await pool.query<any[]>('SELECT descricao, banco_codigo FROM ban_contas WHERE id = ? AND empresa_id = ?', [b.conta_id, empresaId]);
  return { ...boletoPublico(b), dados: b.dados, conta, ocorrencias, instrucoes };
}

async function enviarPdf(res: Response, empresaId: number, linhas: any[], nome: string) {
  const itens = [];
  for (const linha of linhas) {
    const { conta, modulo } = await carregarConta(empresaId, linha.conta_id);
    itens.push({ linha, conta, modulo });
  }
  const pdf = await gerarPdf(itens);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${nome}"`);
  res.send(pdf);
}

function baixarTexto(res: Response, nome: string, conteudo: string) {
  res.setHeader('Content-Type', 'text/plain; charset=latin1');
  res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
  res.send(Buffer.from(conteudo, 'latin1'));
}

// Colunas da conta que a tela grava
const COLUNAS_CONTA = [
  'descricao', 'banco_codigo', 'agencia', 'agencia_dv', 'conta', 'conta_dv', 'beneficiario', 'beneficiario_dv',
  'convenio', 'carteira', 'layout_cnab', 'canal', 'ambiente', 'config', 'ultimo_nosso_numero', 'ultima_remessa', 'ativo',
];

function valoresConta(c: any) {
  const v: Record<string, unknown> = {};
  for (const col of COLUNAS_CONTA) {
    if (!(col in c)) continue;
    let x = c[col];
    if (col === 'config') x = JSON.stringify(x || {});
    else if (typeof x === 'string') x = x.trim() || null;
    v[col] = x;
  }
  if ('descricao' in v && !v.descricao) throw new Error('Informe a descrição da conta.');
  if ('banco_codigo' in v) moduloDoBanco(String(v.banco_codigo || ''));
  if ('canal' in v && !['remessa', 'api'].includes(String(v.canal))) throw new Error('Canal deve ser remessa ou api.');
  if ('layout_cnab' in v && v.layout_cnab && !['240', '400'].includes(String(v.layout_cnab))) throw new Error('Layout CNAB deve ser 240 ou 400.');
  for (const n of ['ultimo_nosso_numero', 'ultima_remessa']) {
    if (n in v && !(Number(v[n]) >= 0 && Number.isInteger(Number(v[n])))) throw new Error('Os contadores precisam ser números inteiros.');
  }
  return v;
}

/** Problemas do cadastro para o banco escolhido (a tela mostra como alerta) */
async function avisosConta(empresaId: number, id: number) {
  const { conta, modulo } = await carregarConta(empresaId, id);
  return modulo.validarConta(conta);
}

export function criarRotas(): Router {
  const r = Router();

  // =========================================================================
  // Bancos e contas
  // =========================================================================
  r.get('/bancos', rota(async (_req, res) => {
    res.json(Object.values(BANCOS).map((b) => ({ codigo: b.codigo, nome: b.nome })));
  }));

  r.get('/contas', rota(async (req, res) => {
    const [linhas] = await pool.query<any[]>(
      `${SELECT_CONTA.replace('SELECT c.*,', `SELECT c.*, k.client_id IS NOT NULL AS tem_credenciais, k.certificado_validade, k.certificado_nome,
              (SELECT COUNT(*) FROM ban_boletos b WHERE b.conta_id = c.id AND b.canal = 'remessa' AND b.situacao = 'emitido') AS boletos_remessa,
              (SELECT COUNT(*) FROM ban_instrucoes i JOIN ban_boletos b ON b.id = i.boleto_id WHERE b.conta_id = c.id AND i.canal = 'remessa' AND i.situacao = 'pendente') AS instrucoes_remessa,`)}
        LEFT JOIN ban_credenciais k ON k.conta_id = c.id
        WHERE c.empresa_id = ? ORDER BY c.ativo DESC, c.descricao`,
      [empresaDaRequisicao(req)],
    );
    res.json(linhas.map((l) => {
      const { e_cnpj: _1, e_razao_social: _2, e_logradouro: _3, e_numero: _4, e_complemento: _5, e_bairro: _6, e_cidade: _7, e_uf: _8, e_cep: _9, ...c } = l;
      return { ...c, config: linhaParaConta(l).config, banco_nome: BANCOS[l.banco_codigo]?.nome || l.banco_codigo };
    }));
  }));

  r.post('/contas', exigirUsuario, rota(async (req, res) => {
    const empresaId = empresaDaRequisicao(req);
    const v = valoresConta(req.body || {});
    for (const obrig of ['descricao', 'banco_codigo', 'agencia', 'conta']) if (!v[obrig]) throw new Error(`Informe: ${obrig.replace('_', ' ')}.`);
    const cols = Object.keys(v);
    const [ins] = await pool.query<any>(
      `INSERT INTO ban_contas (empresa_id, ${cols.join(', ')}, criado_em) VALUES (?, ${cols.map(() => '?').join(', ')}, ?)`,
      [empresaId, ...cols.map((c) => v[c]), dataHoraMysql()],
    );
    res.json({ success: true, id: ins.insertId, avisos: await avisosConta(empresaId, ins.insertId) });
  }));

  r.put('/contas/:id', exigirUsuario, rota(async (req, res) => {
    const empresaId = empresaDaRequisicao(req);
    const id = Number(req.params.id);
    const v = valoresConta(req.body || {});
    const cols = Object.keys(v);
    if (!cols.length) throw new Error('Nada para gravar.');
    const [up] = await pool.query<any>(
      `UPDATE ban_contas SET ${cols.map((c) => `${c} = ?`).join(', ')}, atualizado_em = ? WHERE id = ? AND empresa_id = ?`,
      [...cols.map((c) => v[c]), dataHoraMysql(), id, empresaId],
    );
    if (!up.affectedRows) throw new Error('Conta não encontrada.');
    esquecerTokens(id);
    res.json({ success: true, avisos: await avisosConta(empresaId, id) });
  }));

  /** Grava as credenciais; campo de segredo vazio mantém o que já estava */
  r.put('/contas/:id/credenciais', exigirUsuario, rota(async (req, res) => {
    const empresaId = empresaDaRequisicao(req);
    const id = Number(req.params.id);
    await carregarConta(empresaId, id);
    const c = req.body || {};
    if (!String(c.clientId || '').trim()) throw new Error('Informe o client_id.');

    let certificado: { arquivo: Buffer; nome: string; senha: string; validade: string } | null = null;
    if (c.certificadoBase64) {
      if (!c.certificadoSenha) throw new Error('Informe a senha do certificado.');
      const arquivo = arquivoBase64(c.certificadoBase64);
      // Senha errada ou arquivo inválido falham aqui, antes de gravar
      const { info } = carregarPfx(arquivo, c.certificadoSenha);
      certificado = { arquivo, nome: String(c.certificadoNome || 'certificado.pfx').slice(0, 160), senha: c.certificadoSenha, validade: dataHoraMysql(info.validoAte) };
    }

    const momento = dataHoraMysql();
    await pool.query(
      `INSERT INTO ban_credenciais (conta_id, client_id, client_secret, chave_aplicacao, certificado_nome, certificado, certificado_senha, certificado_validade, atualizado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE client_id = VALUES(client_id),
         client_secret = COALESCE(VALUES(client_secret), client_secret),
         chave_aplicacao = COALESCE(VALUES(chave_aplicacao), chave_aplicacao),
         certificado_nome = COALESCE(VALUES(certificado_nome), certificado_nome),
         certificado = COALESCE(VALUES(certificado), certificado),
         certificado_senha = COALESCE(VALUES(certificado_senha), certificado_senha),
         certificado_validade = COALESCE(VALUES(certificado_validade), certificado_validade),
         atualizado_em = VALUES(atualizado_em)`,
      [
        id, String(c.clientId).trim(), cifrar(c.clientSecret), cifrar(c.chaveAplicacao),
        certificado?.nome ?? null, certificado?.arquivo ?? null, certificado ? cifrar(certificado.senha) : null, certificado?.validade ?? null, momento,
      ],
    );
    esquecerTokens(id);
    esquecerCertificadoConta(id);
    res.json({ success: true });
  }));

  r.delete('/contas/:id/credenciais', exigirUsuario, rota(async (req, res) => {
    const id = Number(req.params.id);
    await carregarConta(empresaDaRequisicao(req), id);
    await pool.query('DELETE FROM ban_credenciais WHERE conta_id = ?', [id]);
    esquecerTokens(id);
    esquecerCertificadoConta(id);
    res.json({ success: true });
  }));

  /** Retorno pela API: liquidações e baixas desde a última consulta */
  r.post('/contas/:id/movimento', rota(async (req, res) => {
    res.json({ success: true, ...(await buscarMovimentoApi(empresaDaRequisicao(req), Number(req.params.id))) });
  }));

  // =========================================================================
  // Boletos
  // =========================================================================
  r.get('/boletos', paginada({
    tabela: 'ban_boletos',
    colunas:
      'id, conta_id, referencia, ambiente, canal, situacao, nosso_numero, nosso_numero_dv, seu_numero, data_emissao, data_vencimento, valor, ' +
      'pagador_documento, pagador_nome, linha_digitavel, remessa_id, data_pagamento, data_credito, valor_pago, codigo_status, motivo, criado_em, ' +
      '(SELECT descricao FROM ban_contas c WHERE c.id = ban_boletos.conta_id) AS conta',
    ordenaveis: {
      data_vencimento: 'data_vencimento', data_emissao: 'data_emissao', valor: 'valor', pagador_nome: 'pagador_nome', situacao: 'situacao',
      nosso_numero: 'nosso_numero', seu_numero: 'seu_numero', referencia: 'referencia', data_pagamento: 'data_pagamento', valor_pago: 'valor_pago',
      criado_em: 'criado_em', conta: 'conta_id', canal: 'canal', motivo: 'motivo',
    },
    busca: ['referencia', 'nosso_numero', 'seu_numero', 'pagador_nome', 'pagador_documento', 'linha_digitavel'],
    ordemPadrao: 'criado_em',
    direcaoPadrao: 'desc',
    filtros: (req) => [
      ...se(req.query.situacao, 'situacao = ?'),
      ...se(req.query.conta, 'conta_id = ?'),
      ...se(dataQuery(req.query.vencimentoDe), 'data_vencimento >= ?'),
      ...se(dataQuery(req.query.vencimentoAte), 'data_vencimento <= ?'),
    ],
  }));

  /** Emissão (tela e módulos). Com ?registrar=0 o canal api só grava, para registrar depois */
  r.post('/boletos', rota(async (req, res) => {
    const empresaId = empresaDaRequisicao(req);
    const { boleto, repetida } = await emitir(empresaId, req.body || {}, { registrar: req.query.registrar !== '0' });
    res.json({ success: true, repetida, boleto: boletoPublico(boleto) });
  }));

  r.get('/boletos/pdf', rota(async (req, res) => {
    const empresaId = empresaDaRequisicao(req);
    const ids = String(req.query.ids || '').split(',').map(Number).filter((n) => n > 0).slice(0, 200);
    if (!ids.length) throw new Error('Informe os boletos (ids).');
    const [linhas] = await pool.query<any[]>(`SELECT * FROM ban_boletos WHERE empresa_id = ? AND id IN (${ids.map(() => '?').join(',')}) ORDER BY id`, [empresaId, ...ids]);
    await enviarPdf(res, empresaId, linhas.map((l) => ({ ...l, dados: typeof l.dados === 'string' ? JSON.parse(l.dados) : l.dados })), 'boletos.pdf');
  }));

  r.get('/boletos/referencia/:referencia', rota(async (req, res) => {
    const empresaId = empresaDaRequisicao(req);
    const b = await boletoPorReferencia(empresaId, String(req.params.referencia));
    if (!b) return res.status(404).json({ success: false, error: `Nenhum boleto com a referência ${req.params.referencia}.` });
    res.json(await detalheBoleto(empresaId, b));
  }));

  r.get('/boletos/referencia/:referencia/pdf', rota(async (req, res) => {
    const empresaId = empresaDaRequisicao(req);
    const b = await boletoPorReferencia(empresaId, String(req.params.referencia));
    if (!b) return res.status(404).json({ success: false, error: `Nenhum boleto com a referência ${req.params.referencia}.` });
    await enviarPdf(res, empresaId, [b], `boleto_${b.id}.pdf`);
  }));

  r.get('/boletos/:id', rota(async (req, res) => {
    const empresaId = empresaDaRequisicao(req);
    res.json(await detalheBoleto(empresaId, await buscarBoleto(empresaId, Number(req.params.id))));
  }));

  r.get('/boletos/:id/pdf', rota(async (req, res) => {
    const empresaId = empresaDaRequisicao(req);
    const b = await buscarBoleto(empresaId, Number(req.params.id));
    await enviarPdf(res, empresaId, [b], `boleto_${b.id}.pdf`);
  }));

  r.post('/boletos/:id/registrar', rota(async (req, res) => {
    const b = await registrarNaApi(empresaDaRequisicao(req), Number(req.params.id));
    res.json({ success: true, boleto: boletoPublico(b) });
  }));

  /** Instrução: { tipo: baixar | alterar_vencimento | ..., dados: { vencimento, valor, abatimento } } */
  r.post('/boletos/:id/instrucoes', rota(async (req, res) => {
    const { tipo, dados } = req.body || {};
    if (!COMANDOS.includes(tipo)) throw new Error(`Tipo de instrução inválido. Use: ${COMANDOS.join(', ')}.`);
    const r2 = await instruir(empresaDaRequisicao(req), Number(req.params.id), tipo, dados || {}, usuarioId(req));
    res.json({ success: true, local: r2.local, instrucao: (r2 as any).instrucao ?? null, boleto: boletoPublico(r2.boleto) });
  }));

  // =========================================================================
  // Remessas
  // =========================================================================
  r.get('/remessas', paginada({
    tabela: 'ban_remessas',
    colunas: 'id, conta_id, numero, layout, nome_arquivo, qtde_registros, valor_total, situacao, criado_em, (SELECT descricao FROM ban_contas c WHERE c.id = ban_remessas.conta_id) AS conta',
    ordenaveis: { criado_em: 'criado_em', numero: 'numero', qtde_registros: 'qtde_registros', valor_total: 'valor_total', situacao: 'situacao', conta: 'conta_id' },
    busca: ['nome_arquivo', 'CAST(numero AS CHAR)', 'situacao'],
    ordemPadrao: 'criado_em',
    direcaoPadrao: 'desc',
    filtros: (req) => se(req.query.conta, 'conta_id = ?'),
  }));

  r.post('/remessas', rota(async (req, res) => {
    res.json({ success: true, ...(await gerarRemessa(empresaDaRequisicao(req), Number(req.body?.contaId), usuarioId(req))) });
  }));

  r.get('/remessas/:id/arquivo', rota(async (req, res) => {
    const [l] = await pool.query<any[]>('SELECT nome_arquivo, conteudo FROM ban_remessas WHERE id = ? AND empresa_id = ?', [Number(req.params.id), empresaDaRequisicao(req)]);
    if (!l.length) throw new Error('Remessa não encontrada.');
    baixarTexto(res, l[0].nome_arquivo, l[0].conteudo);
  }));

  r.post('/remessas/:id/enviada', rota(async (req, res) => {
    await marcarRemessaEnviada(empresaDaRequisicao(req), Number(req.params.id));
    res.json({ success: true });
  }));

  r.post('/remessas/:id/cancelar', rota(async (req, res) => {
    await cancelarRemessa(empresaDaRequisicao(req), Number(req.params.id));
    res.json({ success: true });
  }));

  // =========================================================================
  // Retornos e ocorrências
  // =========================================================================
  r.get('/retornos', paginada({
    tabela: 'ban_retornos',
    colunas:
      'id, conta_id, numero, layout, nome_arquivo, data_arquivo, qtde_registros, criado_em, (SELECT descricao FROM ban_contas c WHERE c.id = ban_retornos.conta_id) AS conta, ' +
      "(SELECT COUNT(*) FROM ban_ocorrencias o WHERE o.retorno_id = ban_retornos.id AND o.tipo = 'liquidacao') AS liquidacoes, " +
      '(SELECT COUNT(*) FROM ban_ocorrencias o WHERE o.retorno_id = ban_retornos.id AND o.boleto_id IS NULL) AS sem_boleto',
    ordenaveis: { criado_em: 'criado_em', numero: 'numero', data_arquivo: 'data_arquivo', nome_arquivo: 'nome_arquivo', qtde_registros: 'qtde_registros', conta: 'conta_id' },
    busca: ['nome_arquivo', 'CAST(numero AS CHAR)'],
    ordemPadrao: 'criado_em',
    direcaoPadrao: 'desc',
    filtros: (req) => se(req.query.conta, 'conta_id = ?'),
  }));

  /** { contaId, nomeArquivo, conteudoBase64 } */
  r.post('/retornos', rota(async (req, res) => {
    const { contaId, nomeArquivo, conteudoBase64 } = req.body || {};
    const conteudo = arquivoBase64(conteudoBase64).toString('latin1');
    res.json({ success: true, ...(await importarRetorno(empresaDaRequisicao(req), Number(contaId), nomeArquivo, conteudo, usuarioId(req))) });
  }));

  r.get('/retornos/:id/arquivo', rota(async (req, res) => {
    const [l] = await pool.query<any[]>('SELECT nome_arquivo, conteudo FROM ban_retornos WHERE id = ? AND empresa_id = ?', [Number(req.params.id), empresaDaRequisicao(req)]);
    if (!l.length) throw new Error('Retorno não encontrado.');
    baixarTexto(res, l[0].nome_arquivo, l[0].conteudo);
  }));

  /**
   * Com ?desde=<id>: canal de volta para os módulos. Devolve as ocorrências com
   * id maior, em ordem, até `limite` (padrão 200); o módulo guarda o último id lido.
   * Sem `desde`: a grade da tela.
   */
  const gradeOcorrencias = paginada({
    tabela: 'ban_ocorrencias',
    colunas:
      'id, conta_id, boleto_id, nosso_numero, origem, retorno_id, tipo, codigo_banco, motivo, data_ocorrencia, data_credito, valor_pago, valor_juros, valor_desconto, valor_tarifa, criado_em, ' +
      '(SELECT referencia FROM ban_boletos b WHERE b.id = ban_ocorrencias.boleto_id) AS referencia, ' +
      '(SELECT pagador_nome FROM ban_boletos b WHERE b.id = ban_ocorrencias.boleto_id) AS pagador_nome',
    ordenaveis: { id: 'id', data_ocorrencia: 'data_ocorrencia', tipo: 'tipo', valor_pago: 'valor_pago', nosso_numero: 'nosso_numero', origem: 'origem', data_credito: 'data_credito' },
    busca: ['nosso_numero', 'motivo', 'codigo_banco'],
    ordemPadrao: 'id',
    direcaoPadrao: 'desc',
    filtros: (req) => [
      ...se(req.query.tipo, 'tipo = ?'),
      ...se(req.query.conta, 'conta_id = ?'),
      ...se(req.query.retorno, 'retorno_id = ?'),
      ...(req.query.semBoleto === '1' ? [['boleto_id IS NULL', []] as [string, unknown[]]] : []),
    ],
  });

  r.get('/ocorrencias', (req, res, proximo) => {
    if (req.query.desde === undefined) return gradeOcorrencias(req, res);
    return rota(async () => {
      const limite = Math.min(1000, Math.max(1, Number(req.query.limite) || 200));
      const [linhas] = await pool.query<any[]>(
        `SELECT o.id, o.boleto_id AS boletoId, b.referencia, b.situacao AS situacaoBoleto, o.conta_id AS contaId, o.nosso_numero AS nossoNumero,
                o.origem, o.tipo, o.codigo_banco AS codigoBanco, o.motivo, o.data_ocorrencia AS dataOcorrencia, o.data_credito AS dataCredito,
                o.valor_titulo AS valorTitulo, o.valor_pago AS valorPago, o.valor_juros AS valorJuros, o.valor_desconto AS valorDesconto,
                o.valor_abatimento AS valorAbatimento, o.valor_tarifa AS valorTarifa, o.criado_em AS criadoEm
           FROM ban_ocorrencias o LEFT JOIN ban_boletos b ON b.id = o.boleto_id
          WHERE o.empresa_id = ? AND o.id > ? ORDER BY o.id LIMIT ?`,
        [empresaDaRequisicao(req), Number(req.query.desde) || 0, limite],
      );
      res.json({ ocorrencias: linhas, ultimoId: linhas.length ? linhas[linhas.length - 1].id : Number(req.query.desde) || 0 });
    })(req, res).catch(proximo);
  });

  // =========================================================================
  // Extratos (OFX) e conciliação
  // =========================================================================
  r.get('/extratos', paginada({
    tabela: 'ban_extratos',
    colunas: 'id, conta_id, origem, nome_arquivo, data_inicial, data_final, saldo, data_saldo, qtde_lancamentos, criado_em, (SELECT descricao FROM ban_contas c WHERE c.id = ban_extratos.conta_id) AS conta',
    ordenaveis: { criado_em: 'criado_em', data_inicial: 'data_inicial', data_final: 'data_final', saldo: 'saldo', qtde_lancamentos: 'qtde_lancamentos', conta: 'conta_id' },
    busca: ['nome_arquivo'],
    ordemPadrao: 'criado_em',
    direcaoPadrao: 'desc',
    filtros: (req) => se(req.query.conta, 'conta_id = ?'),
  }));

  /** { contaId, nomeArquivo, conteudoBase64 } */
  r.post('/extratos', rota(async (req, res) => {
    const { contaId, nomeArquivo, conteudoBase64 } = req.body || {};
    res.json({ success: true, ...(await importarOfx(empresaDaRequisicao(req), Number(contaId), nomeArquivo, arquivoBase64(conteudoBase64), usuarioId(req))) });
  }));

  r.get('/extratos/lancamentos', paginada({
    tabela: 'ban_extrato_lancamentos',
    colunas:
      'id, conta_id, extrato_id, fitid, data_lancamento, valor, tipo, documento, historico, situacao, referencia_conciliacao, conciliado_em, ' +
      '(SELECT descricao FROM ban_contas c WHERE c.id = ban_extrato_lancamentos.conta_id) AS conta, ' +
      '(SELECT COUNT(*) FROM ban_ocorrencias o WHERE o.extrato_lancamento_id = ban_extrato_lancamentos.id) AS liquidacoes',
    ordenaveis: { data_lancamento: 'data_lancamento', valor: 'valor', historico: 'historico', situacao: 'situacao', documento: 'documento', conta: 'conta_id' },
    busca: ['historico', 'documento', 'fitid', 'referencia_conciliacao', 'CAST(valor AS CHAR)'],
    ordemPadrao: 'data_lancamento',
    direcaoPadrao: 'desc',
    filtros: (req) => [
      ...se(req.query.situacao, 'situacao = ?'),
      ...se(req.query.conta, 'conta_id = ?'),
      ...se(req.query.extrato, 'extrato_id = ?'),
      ...se(dataQuery(req.query.de), 'data_lancamento >= ?'),
      ...se(dataQuery(req.query.ate), 'data_lancamento <= ?'),
    ],
  }));

  /** Lançamento com as liquidações de boleto que ele cobre (vínculo automático) */
  r.get('/extratos/lancamentos/:id', rota(async (req, res) => {
    const empresaId = empresaDaRequisicao(req);
    const [l] = await pool.query<any[]>('SELECT * FROM ban_extrato_lancamentos WHERE id = ? AND empresa_id = ?', [Number(req.params.id), empresaId]);
    if (!l.length) throw new Error('Lançamento não encontrado.');
    const [liquidacoes] = await pool.query<any[]>(
      `SELECT o.id, o.nosso_numero, o.valor_pago, o.valor_tarifa, o.data_ocorrencia, b.id AS boleto_id, b.referencia, b.pagador_nome
         FROM ban_ocorrencias o LEFT JOIN ban_boletos b ON b.id = o.boleto_id WHERE o.extrato_lancamento_id = ? ORDER BY o.id`,
      [l[0].id],
    );
    res.json({ ...l[0], liquidacoes });
  }));

  /** { referencia } — referência do lançamento no ERP que cobre este */
  for (const acao of ['conciliar', 'ignorar', 'desfazer'] as const) {
    r.post(`/extratos/lancamentos/:id/${acao}`, rota(async (req, res) => {
      await marcarLancamento(empresaDaRequisicao(req), Number(req.params.id), acao, req.body?.referencia ?? null, usuarioId(req));
      res.json({ success: true });
    }));
  }

  // =========================================================================
  // Chaves de API dos módulos (só usuário da tela)
  // =========================================================================
  r.get('/chaves', exigirUsuario, rota(async (req, res) => {
    const [l] = await pool.query<any[]>(
      'SELECT id, nome, prefixo, ativo, ultimo_uso, criado_em FROM ban_chaves_api WHERE empresa_id = ? ORDER BY ativo DESC, nome',
      [empresaDaRequisicao(req)],
    );
    res.json(l);
  }));

  /** A chave completa só aparece nesta resposta: o banco guarda o SHA-256 */
  r.post('/chaves', exigirUsuario, rota(async (req, res) => {
    const nome = String(req.body?.nome || '').trim();
    if (!nome) throw new Error('Informe o nome do módulo que vai usar a chave.');
    const chave = PREFIXO_CHAVE + crypto.randomBytes(32).toString('base64url');
    await pool.query(
      'INSERT INTO ban_chaves_api (empresa_id, nome, prefixo, chave_hash, criado_em) VALUES (?, ?, ?, ?, ?)',
      [empresaDaRequisicao(req), nome.slice(0, 60), chave.slice(0, 8), hashChave(chave), dataHoraMysql()],
    );
    res.json({ success: true, chave });
  }));

  r.post('/chaves/:id/revogar', exigirUsuario, rota(async (req, res) => {
    const [up] = await pool.query<any>('UPDATE ban_chaves_api SET ativo = 0 WHERE id = ? AND empresa_id = ?', [Number(req.params.id), empresaDaRequisicao(req)]);
    if (!up.affectedRows) throw new Error('Chave não encontrada.');
    esquecerChaves();
    res.json({ success: true });
  }));

  // =========================================================================
  // Log
  // =========================================================================
  r.get('/log', paginada({
    tabela: 'ban_log',
    colunas: 'id, conta_id, operacao, url, referencia, sucesso, codigo_status, motivo, duracao_ms, criado_em',
    ordenaveis: { criado_em: 'criado_em', operacao: 'operacao', referencia: 'referencia', sucesso: 'sucesso', duracao_ms: 'duracao_ms', codigo_status: 'codigo_status', motivo: 'motivo' },
    busca: ['operacao', 'referencia', 'motivo', 'codigo_status', 'url'],
    ordemPadrao: 'criado_em',
    direcaoPadrao: 'desc',
  }));

  r.get('/log/:id', rota(async (req, res) => {
    const [linhas] = await pool.query<any[]>('SELECT * FROM ban_log WHERE empresa_id = ? AND id = ? LIMIT 1', [empresaDaRequisicao(req), Number(req.params.id)]);
    if (!linhas.length) throw new Error('Registro de log não encontrado.');
    res.json(linhas[0]);
  }));

  // =========================================================================
  // Preferências das grades (sys_usuarios.config_listas), do usuário da sessão
  // =========================================================================
  r.get('/config-listas', exigirUsuario, rota(async (req, res) => {
    let config: Record<string, unknown> = {};
    try {
      const [linhas] = await pool.query<any[]>('SELECT config_listas FROM sys_usuarios WHERE id = ? LIMIT 1', [req.usuario!.id]);
      config = JSON.parse(linhas[0]?.config_listas || '{}') || {};
    } catch {
      // Coluna ainda não criada ou JSON inválido: as grades abrem com o padrão
    }
    res.json(config);
  }));

  r.put('/config-listas', exigirUsuario, rota(async (req, res) => {
    const corpo = req.body;
    if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) throw new Error('Configuração inválida.');
    const texto = JSON.stringify(corpo);
    if (texto.length > 60000) throw new Error('Configuração muito grande.');
    await pool.query('UPDATE sys_usuarios SET config_listas = ? WHERE id = ?', [texto, req.usuario!.id]);
    res.json({ success: true });
  }));

  return r;
}

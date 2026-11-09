/**
 * Banco do Brasil (001): nosso número, campo livre, CNAB 240 e API Cobrança v2.
 *
 * Regras tiradas do ACBr (Fontes/ACBrBoleto/ACBrBancoBrasil.pas e
 * WS/ACBrBoletoW_BancoBrasil_API.pas). Convênios de 4, 6 e 7 dígitos:
 *
 *   convênio  nosso número                    campo livre (25)
 *   7         convênio + sequencial(10), sem DV  000000 + nosso número(17) + carteira
 *   6         convênio + sequencial(5) + DV      nosso número(11) + agência(4) + conta(8) + carteira
 *   4         convênio + sequencial(7) + DV      nosso número(11) + agência(4) + conta(8) + carteira
 *
 * A API v2 só existe para convênio de 7 dígitos (numeroTituloCliente = "000" + 17).
 */
import { alfa, arquivo, brancos, data, dataIso, hora, lerData, lerValor, limparTexto, linhas, num, percentual, pos, registro, valor } from '../boleto/cnab.js';
import { digitos, restoModulo11 } from '../boleto/febraban.js';
import type { Boleto, ClienteApi, Comando, Conta, DadosComando, ItemRemessa, ModuloBanco, Ocorrencia, RespostaHttp, TipoOcorrencia } from '../boleto/tipos.js';

const BANCO = '001';

/** Tamanho do sequencial dentro do nosso número, pelo tamanho do convênio (FormataNossoNumero) */
const SEQUENCIAL: Record<number, number> = { 4: 7, 6: 5, 7: 10 };

function convenio(conta: Conta) {
  const conv = digitos(conta.convenio);
  const seq = SEQUENCIAL[conv.length];
  if (!seq) throw new Error(`Convênio do Banco do Brasil com ${conv.length} dígitos não suportado: só 4, 6 ou 7.`);
  return { conv, seq, tamanho: conv.length + seq };
}

/**
 * DV do nosso número (convênios de 4 e 6): módulo 11 com pesos 9 a 2 da direita
 * para a esquerda, o DV é o próprio resto e resto 10 vira X. Como 9..2 = 11 - (2..9),
 * o resto com pesos 9..2 é o oposto (mod 11) do resto com pesos 2..9.
 */
function dvNossoNumero(numero: string): string {
  const r = (11 - restoModulo11(numero)) % 11;
  return r === 10 ? 'X' : String(r);
}

/** Espécie do título: sigla -> código do BB (CNAB 240 posições 107-108 e codigoTipoTitulo da API) */
const ESPECIES: Record<string, number> = {
  CH: 1, DM: 2, DMI: 3, DS: 4, DSI: 5, DR: 6, LC: 7, NCC: 8, NCE: 9, NCI: 10, NCR: 11,
  NP: 12, NPR: 13, TM: 14, TS: 15, NS: 16, RC: 17, FAT: 18, ND: 19, AP: 20, ME: 21, PC: 22,
};

function especie(sigla: string): number {
  const c = ESPECIES[String(sigla || 'DM').toUpperCase()];
  if (!c) throw new Error(`Espécie "${sigla}" não aceita pelo Banco do Brasil (use ${Object.keys(ESPECIES).join(', ')}).`);
  return c;
}

// ---------------------------------------------------------------------------
// CNAB 240
// ---------------------------------------------------------------------------

/**
 * Código de movimento da remessa (GerarRegistroTransacao240). Alteração de valor
 * fica de fora: o ACBr não tem código para ela no CNAB 240 do BB (só pela API).
 */
const MOVIMENTO: Partial<Record<Comando, string>> = {
  registrar: '01',
  baixar: '02',
  conceder_abatimento: '04',
  cancelar_abatimento: '05',
  alterar_vencimento: '06',
  protestar: '09',
  sustar_protesto: '10',
};

function remessa(conta: Conta, numeroRemessa: number, itens: ItemRemessa[], agora: Date): string {
  const e = conta.empresa;
  const doc = digitos(e.cnpj);
  const tipoInscricao = doc.length === 11 ? '1' : '2';
  // Convênio(9) + "0014" + carteira(2) + variação(3): posições 33-50 do header de arquivo, 34-51 do de lote
  const conveniado = num(conta.convenio, 9, 'Convênio') + '0014' + num(conta.carteira, 2, 'Carteira') + num(conta.config.variacao, 3, 'Variação da carteira');
  // Agência(5) + DV + conta(12) + DV + DV agência/conta (branco)
  const agenciaConta = num(conta.agencia, 5, 'Agência') + alfa(conta.agenciaDv, 1) + num(conta.conta, 12, 'Conta') + alfa(conta.contaDv, 1) + ' ';
  const hoje = data(dataIso(agora));
  const nsa = num(numeroRemessa, 6, 'Número da remessa');
  const carteira = num(conta.carteira, 2);
  // Posição 58 do P: 1 = simples (carteiras 11/12/31/51); 7 = carteira 15/16/17/18 (cobrança direta especial)
  const tipoCarteira = ['11', '12', '31', '51'].includes(carteira) ? '1' : '7';

  const saida = [
    registro(240,
      BANCO, '0000', '0', brancos(9), tipoInscricao, num(doc, 14, 'CNPJ do beneficiário'), conveniado, brancos(2), agenciaConta,
      alfa(e.razaoSocial, 30), alfa('BANCO DO BRASIL', 30), brancos(10), '1', hoje, hora(agora), nsa,
      '030', '00000', brancos(20), '0'.repeat(20), brancos(11), 'CSP', '000', brancos(12)),
    registro(240,
      BANCO, '0001', '1', 'R', '01', brancos(2), '020', ' ', tipoInscricao, num(doc, 15), conveniado,
      conta.ambiente === 2 ? 'TS' : brancos(2), // TS = arquivo de teste (homologação)
      agenciaConta, alfa(e.razaoSocial, 30), brancos(80), num(numeroRemessa, 8), hoje, '0'.repeat(8), brancos(33)),
  ];

  let seq = 0;
  const detalhe = (segmento: string, movimento: string, ...resto: string[]) =>
    registro(240, BANCO, '0001', '3', num(++seq, 5, 'Registros no lote'), segmento, ' ', movimento, ...resto);

  for (const { comando, boleto: b, dados = {} } of itens) {
    const mov = MOVIMENTO[comando];
    if (!mov) throw new Error(`O Banco do Brasil não aceita "${comando}" pela remessa CNAB 240: use a API.`);
    if (comando === 'alterar_vencimento' && !dados.vencimento) throw new Error(`Boleto ${b.nossoNumero}: informe o novo vencimento.`);
    const abatimento = dados.abatimento ?? b.abatimento;
    if (comando === 'conceder_abatimento' && !(Number(abatimento) > 0)) throw new Error(`Boleto ${b.nossoNumero}: informe o valor do abatimento.`);
    const j = b.juros;
    const d = b.desconto;
    const protesto = Number(b.diasProtesto) || 0;

    saida.push(detalhe('P', mov,
      agenciaConta,                                                    // 18-37
      alfa(b.nossoNumero + b.nossoNumeroDv, 20),                       // 38-57
      tipoCarteira, '1', '1', '22',                                    // 58-62 cadastramento, documento tradicional, cliente emite e distribui
      alfa(b.seuNumero, 15),                                           // 63-77
      data(comando === 'alterar_vencimento' ? dados.vencimento : b.dataVencimento), // 78-85
      valor(b.valor, 15, 'Valor do boleto'),                           // 86-100
      '00000 ',                                                        // 101-106 agência cobradora: o banco escolhe
      num(especie(b.especie), 2),                                      // 107-108
      b.aceite === 'A' ? 'A' : 'N',                                    // 109
      data(b.dataEmissao),                                             // 110-117
      j ? '2' : '3', data(j?.data), percentual(j?.percentualMensal, 15), // 118-141 juros: 2 = taxa mensal, 3 = isento
      d ? '1' : '0', data(d?.data), valor(d?.valor, 15, 'Desconto'),     // 142-165 desconto: 1 = valor fixo até a data
      valor(0, 15),                                                    // 166-180 IOF
      valor(abatimento, 15, 'Abatimento'),                             // 181-195
      alfa(b.seuNumero, 25),                                           // 196-220 uso da empresa (volta no retorno)
      protesto > 0 ? '1' : '3', num(protesto, 2, 'Dias de protesto'),  // 221-223 1 = dias corridos, 3 = não protestar
      '0', comando === 'registrar' ? num(b.diasBaixa ?? 0, 3, 'Dias para baixa') : brancos(3), // 224-227
      '09', '0'.repeat(10), ' '));                                     // 228-240 moeda real

    const g = b.pagador;
    const docPagador = digitos(g.documento);
    saida.push(detalhe('Q', mov,
      docPagador.length === 14 ? '2' : '1', num(docPagador, 15, 'CPF/CNPJ do pagador'), // 18-33
      alfa(g.nome, 40), alfa([g.logradouro, g.numero, g.complemento].filter(Boolean).join(' '), 40), // 34-113
      alfa(g.bairro, 15), num(g.cep, 8, 'CEP do pagador'), alfa(g.cidade, 15), alfa(g.uf, 2), // 114-153
      '0', '0'.repeat(15), brancos(40),                                // 154-209 sem sacador/avalista
      '000', brancos(28)));                                            // 210-240

    // R só na entrada com multa (o boleto não tem 2º/3º desconto)
    if (comando === 'registrar' && b.multa) {
      saida.push(detalhe('R', mov,
        '0'.repeat(48),                                                // 18-65 2º e 3º descontos
        '2', data(b.multa.data), percentual(b.multa.percentual, 15),   // 66-89 multa: 2 = percentual
        brancos(10), alfa(b.mensagens?.[0], 40), brancos(60),          // 90-199 mensagem 3
        '0'.repeat(32), brancos(9)));                                  // 200-240
    }
  }

  saida.push(registro(240, BANCO, '0001', '5', brancos(9), num(seq + 2, 6), '0'.repeat(92), brancos(125)));
  saida.push(registro(240, BANCO, '9999', '9', brancos(9), '000001', num(seq + 4, 6), brancos(211)));
  return arquivo(saida);
}

/** Código de movimento do retorno -> tipo e descrição (CodOcorrenciaToTipo / TipoOcorrenciaToDescricao, layout 240) */
const OCORRENCIAS: Record<string, [TipoOcorrencia, string]> = {
  '02': ['entrada', 'Entrada confirmada'],
  '03': ['rejeicao', 'Entrada rejeitada'],
  '04': ['outra', 'Transferência de carteira/entrada'],
  '05': ['outra', 'Transferência de carteira/baixa'],
  '06': ['liquidacao', 'Liquidação'],
  '09': ['baixa', 'Baixa'],
  '11': ['outra', 'Títulos em carteira (em ser)'],
  '12': ['alteracao', 'Confirmação de recebimento de instrução de abatimento'],
  '13': ['alteracao', 'Confirmação de recebimento de instrução de cancelamento de abatimento'],
  '14': ['alteracao', 'Confirmação de recebimento de instrução de alteração de vencimento'],
  '15': ['baixa', 'Franco de pagamento'],
  '17': ['liquidacao', 'Liquidação após baixa ou liquidação de título não registrado'],
  '19': ['protesto', 'Confirmação de recebimento de instrução de protesto'],
  '20': ['protesto', 'Confirmação de recebimento de instrução de sustação/cancelamento de protesto'],
  '23': ['protesto', 'Remessa a cartório'],
  '24': ['protesto', 'Retirada de cartório e manutenção em carteira'],
  '25': ['protesto', 'Protestado e baixado'],
  '26': ['rejeicao', 'Instrução rejeitada'],
  '27': ['alteracao', 'Confirmação do pedido de alteração de outros dados'],
  '28': ['tarifa', 'Débito de tarifas/custas'],
  '29': ['outra', 'Ocorrências do pagador'],
  '30': ['rejeicao', 'Alteração de dados rejeitada'],
  '44': ['outra', 'Título pago com cheque devolvido'],
  '50': ['outra', 'Título pago com cheque pendente de compensação'],
  '85': ['outra', 'Inclusão de negativação'],
  '86': ['outra', 'Exclusão de negativação'],
};

/** Motivos de rejeição (FEBRABAN, valem para 03, 26 e 30) — CodMotivoRejeicaoToDescricao */
const REJEICOES: Record<string, string> = {
  '01': 'Código do banco inválido', '02': 'Código do registro detalhe inválido', '03': 'Código do segmento inválido',
  '04': 'Código de movimento não permitido para a carteira', '05': 'Código de movimento inválido',
  '06': 'Tipo/número de inscrição do beneficiário inválidos', '07': 'Agência/conta/DV inválido', '08': 'Nosso número inválido',
  '09': 'Nosso número duplicado', '10': 'Carteira inválida', '11': 'Forma de cadastramento do título inválida',
  '12': 'Tipo de documento inválido', '13': 'Identificação da emissão do boleto inválida',
  '14': 'Identificação da distribuição do boleto inválida', '15': 'Características da cobrança incompatíveis',
  '16': 'Data de vencimento inválida', '17': 'Data de vencimento anterior à data de emissão',
  '18': 'Vencimento fora do prazo de operação', '19': 'Título a cargo de bancos correspondentes com vencimento inferior ao prazo',
  '20': 'Valor do título inválido', '21': 'Espécie do título inválida', '22': 'Espécie não permitida para a carteira',
  '23': 'Aceite inválido', '24': 'Data da emissão inválida', '25': 'Data da emissão posterior à data de entrada',
  '26': 'Código de juros de mora inválido', '27': 'Valor/taxa de juros de mora inválido', '28': 'Código do desconto inválido',
  '29': 'Valor do desconto maior ou igual ao valor do título', '30': 'Desconto a conceder não confere',
  '31': 'Concessão de desconto: já existe desconto anterior', '32': 'Valor do IOF inválido', '33': 'Valor do abatimento inválido',
  '34': 'Valor do abatimento maior ou igual ao valor do título', '35': 'Abatimento a conceder não confere',
  '36': 'Concessão de abatimento: já existe abatimento anterior', '37': 'Código para protesto inválido',
  '38': 'Prazo para protesto inválido', '39': 'Pedido de protesto não permitido para o título',
  '40': 'Título com ordem de protesto emitida', '41': 'Pedido de cancelamento/sustação para título sem instrução de protesto',
  '42': 'Código para baixa/devolução inválido', '43': 'Prazo para baixa/devolução inválido', '44': 'Código da moeda inválido',
  '45': 'Nome do pagador não informado', '46': 'Tipo/número de inscrição do pagador inválidos',
  '47': 'Endereço do pagador não informado', '48': 'CEP inválido', '49': 'CEP sem praça de cobrança (não localizado)',
  '50': 'CEP referente a um banco correspondente', '51': 'CEP incompatível com a unidade da federação',
  '52': 'Unidade da federação inválida', '53': 'Tipo/número de inscrição do sacador/avalista inválidos',
  '54': 'Sacador/avalista não informado', '55': 'Nosso número no banco correspondente não informado',
  '56': 'Código do banco correspondente não informado', '57': 'Código da multa inválido', '58': 'Data da multa inválida',
  '59': 'Valor/percentual da multa inválido', '60': 'Movimento para título não cadastrado',
  '61': 'Alteração da agência cobradora/DV inválida', '62': 'Tipo de impressão inválido', '63': 'Entrada para título já cadastrado',
  '64': 'Número da linha inválido', '65': 'Código do banco para débito inválido', '66': 'Agência/conta/DV para débito inválido',
  '67': 'Dados para débito incompatíveis com a identificação da emissão do boleto', '88': 'Arquivo em duplicidade',
  '99': 'Contrato inexistente',
  A1: 'Rejeição da alteração do número de controle do participante', A2: 'Rejeição da alteração dos dados do pagador',
  A3: 'Rejeição da alteração dos dados do sacador/avalista', A4: 'Pagador DDA', A5: 'Registro rejeitado: título já liquidado',
  A6: 'Código do convenente inválido ou encerrado', A7: 'Título já se encontra na situação pretendida',
  A8: 'Valor do abatimento inválido para cancelamento', A9: 'Não autoriza pagamento parcial',
};

const LIQUIDACOES: Record<string, string> = {
  '01': 'Por saldo', '02': 'Parcial', '03': 'No próprio banco', '04': 'Compensação eletrônica', '05': 'Compensação convencional',
  '06': 'Por meio eletrônico', '07': 'Após feriado local', '08': 'Em cartório', '30': 'Liquidação no guichê de caixa em cheque',
  '99': 'Liquidado por agendamento',
};

const BAIXAS: Record<string, string> = {
  '09': 'Comandada banco', '10': 'Comandada cliente arquivo', '11': 'Comandada cliente on-line', '12': 'Decurso de prazo - cliente',
  '13': 'Decurso de prazo - banco', '14': 'Protestado', '15': 'Título excluído', '18': 'Por alteração de carteira',
  '19': 'Débito automático', '31': 'Liquidado anteriormente', '32': 'Habilitado em processo',
  '33': 'Incobrável por nosso intermédio', '34': 'Transferido para créditos em liquidação', '46': 'Por alteração da variação',
  '47': 'Por alteração da variação', '51': 'Acerto', '90': 'Baixa automática',
};

const TARIFAS: Record<string, string> = {
  '01': 'Tarifa de extrato de posição', '02': 'Tarifa de manutenção de título vencido', '03': 'Tarifa de sustação',
  '04': 'Tarifa de protesto', '05': 'Tarifa de outras instruções', '06': 'Tarifa de outras ocorrências',
  '07': 'Tarifa de envio de duplicata ao pagador', '08': 'Custas de protesto', '09': 'Custas de sustação de protesto',
  '10': 'Custas de cartório distribuidor', '11': 'Custas de edital', '12': 'Tarifa sobre devolução de título vencido',
  '13': 'Tarifa sobre registro cobrada na baixa/liquidação', '14': 'Tarifa sobre reapresentação automática',
  '15': 'Tarifa sobre rateio de crédito', '16': 'Tarifa sobre informações via fax', '17': 'Tarifa sobre prorrogação de vencimento',
  '18': 'Tarifa sobre alteração de abatimento/desconto', '19': 'Tarifa sobre arquivo mensal (em ser)',
  '20': 'Tarifa sobre emissão de boleto pré-emitido pelo banco',
};

const MOTIVOS: Record<string, Record<string, string>> = {
  '03': REJEICOES, '26': REJEICOES, '30': REJEICOES, '06': LIQUIDACOES, '17': LIQUIDACOES, '09': BAIXAS, '28': TARIFAS,
};

function retorno(conteudo: string, conta: Conta) {
  const ls = linhas(conteudo);
  const h = ls[0] || '';
  if (pos(h, 1, 3) !== BANCO || pos(h, 8, 8) !== '0') throw new Error('Não é um arquivo CNAB 240 do Banco do Brasil: a primeira linha não é um header de arquivo do banco 001.');
  if (pos(h, 143, 143) !== '2') throw new Error('Este arquivo é uma remessa, não um retorno.');
  if (Number(pos(h, 19, 32)) !== Number(digitos(conta.empresa.cnpj))) throw new Error(`O retorno é de outro beneficiário (CPF/CNPJ ${pos(h, 19, 32)}).`);
  const { tamanho } = convenio(conta);

  const ocorrencias: Ocorrencia[] = [];
  let atual: Ocorrencia | undefined;
  for (const l of ls) {
    if (pos(l, 8, 8) !== '3') continue;
    const segmento = pos(l, 14, 14);
    if (segmento === 'T') {
      const codigo = pos(l, 16, 17);
      const [tipo, descricao] = OCORRENCIAS[codigo] || ['outra', 'Ocorrência'];
      const tabela = MOTIVOS[codigo] || {};
      const motivos = (pos(l, 214, 223).match(/.{2}/g) || [])
        .map((m) => m.trim())
        .filter((m) => m && m !== '00')
        .map((m) => (tabela[m] ? `${m}-${tabela[m]}` : `motivo ${m}`));
      atual = {
        // Mesmo formato de nossoNumero().numero: 17 dígitos (convênio 7) ou 11 sem o DV (convênios 4 e 6)
        nossoNumero: pos(l, 38, 37 + tamanho).trim(),
        seuNumero: pos(l, 59, 73).trim() || pos(l, 106, 130).trim() || undefined,
        tipo,
        codigoBanco: codigo,
        motivo: `${codigo} ${descricao}${motivos.length ? `: ${motivos.join('; ')}` : ''}`,
        dataOcorrencia: '',
        valorTitulo: lerValor(l, 82, 96) || undefined,
        valorTarifa: lerValor(l, 199, 213) || undefined,
      };
      ocorrencias.push(atual);
    } else if (segmento === 'U' && atual) {
      atual.valorJuros = lerValor(l, 18, 32) || undefined; // juros + multa + encargos
      atual.valorDesconto = lerValor(l, 33, 47) || undefined;
      atual.valorAbatimento = lerValor(l, 48, 62) || undefined;
      atual.valorPago = lerValor(l, 78, 92) || undefined;
      atual.dataOcorrencia = lerData(l, 138, 145);
      atual.dataCredito = lerData(l, 146, 153) || undefined;
      atual = undefined;
    }
  }
  return { numero: Number(pos(h, 158, 163)) || undefined, dataArquivo: lerData(h, 144, 151) || undefined, ocorrencias };
}

// ---------------------------------------------------------------------------
// API Cobrança v2
// ---------------------------------------------------------------------------

const AMBIENTES = {
  1: { api: 'https://api.bb.com.br/cobrancas/v2', oauth: 'https://oauth.bb.com.br/oauth/token' },
  2: { api: 'https://api.hm.bb.com.br/cobrancas/v2', oauth: 'https://oauth.hm.bb.com.br/oauth/token' },
};
const ESCOPO = 'cobrancas.boletos-info cobrancas.boletos-requisicao';

/** codigoEstadoTituloCobranca da listagem que viram ocorrência no movimento */
const ESTADOS: Record<number, TipoOcorrencia> = {
  6: 'liquidacao', // LIQUIDADO
  10: 'liquidacao', // BAIXADO/PAGO EM CARTORIO
  11: 'liquidacao', // LIQUIDADO/PROTESTADO
  12: 'liquidacao', // LIQUIDADO/PAGO EM CARTORIO
  16: 'liquidacao', // CREDITADO
  7: 'baixa', // BAIXADO
};

const MENSAGEM_STATUS: Record<number, string> = {
  401: 'credenciais recusadas ou token vencido',
  403: 'acesso negado (confira o escopo, o gw-dev-app-key e o certificado)',
  404: 'não encontrado',
  500: 'erro interno do Banco do Brasil',
  503: 'serviço do Banco do Brasil indisponível; tente mais tarde',
};

const ok = (r: RespostaHttp) => r.status >= 200 && r.status < 300;

/** O BB diz que o título não existe: 404, ou 400 com mensagem de "não encontrado" */
const naoEncontrado = (r: RespostaHttp) =>
  r.status === 404 || (r.status === 400 && /n[ãa]o\s+(foi\s+)?(encontrad|localizad|cadastrad)|inexistente/i.test(r.texto));

/** Erro legível a partir do corpo do BB: erros[] (mensagem/textoMensagem), errors[] (message) ou error/message */
function falha(r: RespostaHttp, oque: string): Error {
  const c = r.corpo && typeof r.corpo === 'object' ? r.corpo : {};
  const lista = [...(Array.isArray(c.erros) ? c.erros : []), ...(Array.isArray(c.errors) ? c.errors : [])];
  const msgs = lista
    .map((e: any) => {
      const texto = String(e?.mensagem || e?.textoMensagem || e?.message || '').trim();
      const codigo = e?.codigo || e?.codigoMensagem || e?.code;
      return texto && codigo ? `${texto} (código ${codigo})` : texto;
    })
    .filter(Boolean);
  if (!msgs.length) {
    const solto = String(c.error_description || c.message || c.error || '').trim() || (typeof r.corpo === 'string' ? r.corpo.trim().slice(0, 200) : '');
    msgs.push(solto || MENSAGEM_STATUS[r.status] || 'sem detalhe');
  }
  return new Error(`Banco do Brasil: ${oque} falhou (HTTP ${r.status}): ${msgs.join('; ')}`);
}

async function chamar(cli: ClienteApi, conta: Conta, metodo: 'GET' | 'POST' | 'PATCH', caminho: string, operacao: string, corpo?: unknown, consulta: Record<string, string> = {}) {
  const amb = AMBIENTES[conta.ambiente === 1 ? 1 : 2];
  const token = await cli.oauth({ url: amb.oauth, escopo: ESCOPO, autenticacao: 'basic' });
  const qs = new URLSearchParams({ 'gw-dev-app-key': cli.credenciais.chaveAplicacao, ...consulta });
  return cli.pedir({ metodo, url: `${amb.api}${caminho}?${qs}`, corpo, cabecalhos: { Authorization: `Bearer ${token}` }, operacao });
}

/** Identificador do boleto na API: "000" + convênio(7) + sequencial(10) */
function idApi(conta: Conta, b: Boleto): string {
  if (digitos(conta.convenio).length !== 7 || !/^\d{17}$/.test(b.nossoNumero)) {
    throw new Error('A API Cobrança do Banco do Brasil só atende convênio de 7 dígitos (nosso número de 17 posições).');
  }
  return `000${b.nossoNumero}`;
}

/** "AAAA-MM-DD" -> "DD.MM.AAAA" */
const dataBB = (iso: string) => {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) throw new Error(`Data inválida para a API do Banco do Brasil: "${iso}".`);
  return `${m[3]}.${m[2]}.${m[1]}`;
};

/** "DD.MM.AAAA" -> "AAAA-MM-DD" (vazio se não for data) */
const isoBB = (v: unknown) => {
  const m = String(v ?? '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
};

/** Corpo do POST /boletos (RequisicaoJson do ACBr) */
function corpoRegistro(conta: Conta, b: Boleto) {
  const protesto = Number(b.diasProtesto) || 0;
  if (protesto && !((protesto >= 6 && protesto <= 29) || [35, 40, 45].includes(protesto))) {
    throw new Error(`Banco do Brasil: protesto em dias corridos aceita de 6 a 29, 35, 40 ou 45 dias (veio ${protesto}).`);
  }
  const baixa = Number(b.diasBaixa) || 0;
  const g = b.pagador;
  const doc = digitos(g.documento);
  return {
    numeroConvenio: Number(digitos(conta.convenio)),
    numeroCarteira: Number(digitos(conta.carteira)),
    numeroVariacaoCarteira: Number(digitos(conta.config.variacao)),
    codigoModalidade: 1,
    dataEmissao: dataBB(b.dataEmissao),
    dataVencimento: dataBB(b.dataVencimento),
    valorOriginal: b.valor,
    valorAbatimento: b.abatimento || 0,
    quantidadeDiasProtesto: protesto,
    indicadorAceiteTituloVencido: baixa > 0 ? 'S' : 'N',
    numeroDiasLimiteRecebimento: baixa,
    codigoAceite: b.aceite === 'A' ? 'A' : 'N',
    codigoTipoTitulo: especie(b.especie),
    descricaoTipoTitulo: String(b.especie || 'DM').toUpperCase(),
    indicadorPermissaoRecebimentoParcial: 'N',
    campoUtilizacaoBeneficiario: limparTexto(b.seuNumero).replace(/[^A-Z0-9 .-]/g, '').trim().slice(0, 30),
    numeroTituloBeneficiario: String(b.seuNumero || '').trim().toUpperCase().slice(0, 15),
    numeroTituloCliente: idApi(conta, b),
    mensagemBloquetoOcorrencia: (b.mensagens || []).join(' ').trim().toUpperCase().slice(0, 30),
    ...(b.desconto ? { desconto: { tipo: 1, dataExpiracao: dataBB(b.desconto.data), valor: b.desconto.valor } } : {}),
    ...(b.juros ? { jurosMora: { tipo: 2, porcentagem: b.juros.percentualMensal } } : {}),
    ...(b.multa ? { multa: { tipo: 2, data: dataBB(b.multa.data), porcentagem: b.multa.percentual } } : {}),
    pagador: {
      tipoInscricao: doc.length === 11 ? 1 : 2,
      numeroInscricao: doc,
      nome: g.nome,
      endereco: [g.logradouro, g.numero].filter(Boolean).join(' '),
      cep: Number(digitos(g.cep)),
      cidade: g.cidade,
      bairro: g.bairro,
      uf: g.uf,
    },
    indicadorPix: b.pixHibrido ? 'S' : 'N',
  };
}

/** Corpo do PATCH /boletos/{id} para cada instrução (RequisicaoAltera do ACBr) */
function corpoAlteracao(b: Boleto, comando: Exclude<Comando, 'registrar' | 'baixar'>, d: DadosComando) {
  switch (comando) {
    case 'alterar_vencimento':
      if (!d.vencimento) throw new Error('Informe o novo vencimento.');
      return { indicadorNovaDataVencimento: 'S', alteracaoData: { novaDataVencimento: dataBB(d.vencimento) } };
    case 'alterar_valor':
      if (!(Number(d.valor) > 0)) throw new Error('Informe o novo valor.');
      return { indicadorNovoValorNominal: 'S', alteracaoValor: { novoValorNominal: d.valor } };
    case 'conceder_abatimento':
      if (!(Number(d.abatimento) > 0)) throw new Error('Informe o valor do abatimento.');
      return { indicadorIncluirAbatimento: 'S', abatimento: { valorAbatimento: d.abatimento } };
    case 'cancelar_abatimento':
      return { indicadorAlterarAbatimento: 'S', alteracaoAbatimento: { novoValorAbatimento: 0 } };
    case 'protestar': {
      const dias = Number(b.diasProtesto) || 0;
      return { indicadorProtestar: 'S', ...(dias > 0 ? { protesto: { quantidadeDiasProtesto: dias } } : {}) };
    }
    case 'sustar_protesto':
      return { indicadorSustacaoProtesto: 'S' };
  }
}

// ---------------------------------------------------------------------------
// Módulo
// ---------------------------------------------------------------------------

export const bb: ModuloBanco = {
  codigo: BANCO,
  nome: 'Banco do Brasil',

  validarConta(c) {
    const p: string[] = [];
    const t = (v: unknown) => String(v ?? '').trim();
    if (!/^\d{1,4}$/.test(t(c.agencia))) p.push('Agência: até 4 dígitos, sem o DV.');
    if (!/^[0-9X]$/i.test(t(c.agenciaDv))) p.push('DV da agência: 1 dígito ou X.');
    if (!/^\d{1,8}$/.test(t(c.conta))) p.push('Conta: até 8 dígitos, sem o DV.');
    if (!/^[0-9X]$/i.test(t(c.contaDv))) p.push('DV da conta: 1 dígito ou X.');
    const conv = t(c.convenio);
    if (!/^\d+$/.test(conv) || !SEQUENCIAL[conv.length]) {
      p.push(`Convênio: o Banco do Brasil usa 4, 6 ou 7 dígitos${conv ? ` (veio "${conv}", ${conv.length} posições)` : ''}; outros tamanhos não são suportados.`);
    } else if (c.canal === 'api' && conv.length !== 7) {
      p.push('A API Cobrança do Banco do Brasil só atende convênio de 7 dígitos: use a remessa CNAB 240.');
    }
    if (!/^\d{2}$/.test(t(c.carteira))) p.push('Carteira: 2 dígitos (ex.: 17).');
    if (!/^\d{1,3}$/.test(t(c.config?.variacao))) p.push('Variação da carteira: obrigatória no Banco do Brasil, até 3 dígitos (ex.: 019).');
    if (c.layoutCnab === '400') p.push('Remessa do Banco do Brasil: só o layout CNAB 240 está implementado.');
    return p;
  },

  nossoNumero(conta, sequencial) {
    const { conv, seq } = convenio(conta);
    if (!Number.isSafeInteger(sequencial) || sequencial < 1) throw new Error(`Sequencial do nosso número inválido: ${sequencial}.`);
    const numero = conv + num(sequencial, seq, `Sequencial do nosso número (convênio de ${conv.length} dígitos)`);
    return { numero, dv: conv.length === 7 ? '' : dvNossoNumero(numero) };
  },

  nossoNumeroImpresso: (_conta, numero, dv) => (dv ? `${numero}-${dv}` : numero),

  campoLivre(conta, numero) {
    const { conv, tamanho } = convenio(conta);
    if (!/^\d+$/.test(numero) || numero.length !== tamanho || !numero.startsWith(conv)) {
      throw new Error(`Nosso número "${numero}" não é do convênio ${conv} (esperado ${tamanho} dígitos começando por ele).`);
    }
    const carteira = num(conta.carteira, 2, 'Carteira');
    return conv.length === 7
      ? `000000${numero}${carteira}`
      : `${numero}${num(conta.agencia, 4, 'Agência')}${num(conta.conta, 8, 'Conta')}${carteira}`;
  },

  // MontarCampoCodigoCedente: agência-DV/conta sem zeros à esquerda-DV ("5214-1/523218-X")
  agenciaCodigoBeneficiario: (c) => `${digitos(c.agencia)}-${c.agenciaDv}/${Number(digitos(c.conta))}-${c.contaDv}`,

  carteiraImpressa: (c) => (c.config.variacao ? `${c.carteira}/${c.config.variacao}` : c.carteira),

  cnab240: { remessa, retorno },

  api: {
    async registrar(cli, conta, b) {
      const r = await chamar(cli, conta, 'POST', '/boletos', 'registrar', corpoRegistro(conta, b));
      if (!ok(r)) throw falha(r, 'registro do boleto');
      const c = r.corpo || {};
      return {
        nossoNumero: b.nossoNumero,
        nossoNumeroDv: b.nossoNumeroDv,
        codigoBarras: digitos(c.codigoBarraNumerico) || undefined,
        linhaDigitavel: digitos(c.linhaDigitavel) || undefined,
        pixEmv: c.qrCode?.emv || undefined,
      };
    },

    async consultar(cli, conta, b) {
      const r = await chamar(cli, conta, 'GET', `/boletos/${idApi(conta, b)}`, 'consultar', undefined, { numeroConvenio: digitos(conta.convenio) });
      if (naoEncontrado(r)) return { registrado: false };
      if (!ok(r)) throw falha(r, 'consulta do boleto');
      const c = r.corpo || {};
      return {
        registrado: true,
        resultado: {
          nossoNumero: b.nossoNumero,
          nossoNumeroDv: b.nossoNumeroDv,
          codigoBarras: digitos(c.textoCodigoBarrasTituloCobranca) || undefined,
          linhaDigitavel: digitos(c.codigoLinhaDigitavel) || undefined,
        },
      };
    },

    async instruir(cli, conta, b, comando, dados = {}) {
      const id = `/boletos/${idApi(conta, b)}`;
      const numeroConvenio = Number(digitos(conta.convenio));
      const r = comando === 'baixar'
        ? await chamar(cli, conta, 'POST', `${id}/baixar`, 'baixar', { numeroConvenio })
        : await chamar(cli, conta, 'PATCH', id, comando, { numeroConvenio, ...corpoAlteracao(b, comando, dados) });
      if (!ok(r)) throw falha(r, `instrução "${comando}"`);
    },

    async movimento(cli, conta, de, ate) {
      const conv = digitos(conta.convenio);
      const ocorrencias: Ocorrencia[] = [];
      let indice = 0;
      for (;;) {
        const r = await chamar(cli, conta, 'GET', '/boletos', 'movimento', undefined, {
          indicadorSituacao: 'B',
          agenciaBeneficiario: String(Number(digitos(conta.agencia))),
          contaBeneficiario: String(Number(digitos(conta.conta))),
          dataInicioMovimento: dataBB(de),
          dataFimMovimento: dataBB(ate),
          ...(indice ? { indice: String(indice) } : {}),
        });
        if (naoEncontrado(r)) break; // nenhum boleto no período
        if (!ok(r)) throw falha(r, 'consulta do movimento');
        for (const i of r.corpo?.boletos || []) {
          const nn = digitos(i.numeroBoletoBB).slice(-17);
          const tipo = ESTADOS[Number(i.codigoEstadoTituloCobranca)];
          if (!tipo || !nn.startsWith(conv)) continue; // outro estado ou outro convênio da mesma conta
          ocorrencias.push({
            nossoNumero: nn,
            tipo,
            codigoBanco: String(i.codigoEstadoTituloCobranca),
            motivo: `${i.codigoEstadoTituloCobranca} ${String(i.estadoTituloCobranca || '').trim()}`.trim(),
            dataOcorrencia: isoBB(i.dataMovimento),
            dataCredito: isoBB(i.dataCredito) || undefined,
            valorTitulo: Number(i.valorOriginal) || undefined,
            valorPago: Number(i.valorPago) || undefined,
          });
        }
        const proximo = Number(r.corpo?.proximoIndice);
        if (r.corpo?.indicadorContinuidade !== 'S' || !(proximo > indice)) break;
        indice = proximo;
      }
      return ocorrencias;
    },
  },
};

/**
 * Sicoob (756): nosso número, campo livre, CNAB 240 e API Cobrança Bancária v3.
 *
 * Tudo segue os fontes do ACBr: ACBrBancoSicoob.pas (layout 081 / lote 040) e
 * WS/ACBrBoletoW_Sicoob_V3.pas + WS/ACBrBoletoRet_Sicoob_V3.pas.
 *
 * Como cada campo da Conta entra no Sicoob (conferido no ACBr):
 *   agencia            cooperativa, 4 posições (Cedente.Agencia): DV do nosso número,
 *                      campo livre, headers e segmento P.
 *   agenciaDv          o ACBr manda informar aqui o número do POSTO (1 posição); vazio sai "0".
 *   beneficiario + Dv  código do cliente (Cedente.CodigoCedente, já com o DV no fim):
 *                      10 posições no DV do nosso número, 7 no campo livre, impresso "codigo-DV".
 *   conta / contaDv    conta corrente: 12 + 1 no CNAB 240; numeroContaCorrente (conta+DV) na API.
 *   carteira           1 ou 3 (campo livre e P.58). A carteira 9 (barras com o nº do contrato,
 *                      CodigoTransmissao no ACBr) não é atendida aqui.
 *   config.modalidade  2 posições no campo livre e em P.50-51; codigoModalidade na API. Vazio = 01.
 *   config.numeroCliente  numeroCliente da API; vazio = beneficiario + beneficiarioDv (o ACBr usa
 *                      o CodigoCedente).
 *   convenio           só no header do arquivo (33-52), como o ACBr.
 *
 * Nosso número: Boleto.nossoNumero tem 7 dígitos SEM o DV; o DV fica em nossoNumeroDv.
 *   - CNAB remessa: P.38-47 = "00" + 7 dígitos + DV.
 *   - CNAB retorno: T.40-46 = os mesmos 7 dígitos, SEM o DV (que fica em T.47), igual ao ACBr.
 *   - API: o Sicoob trata o nosso número COM o DV no fim e sem zeros (0000021-8 -> 218).
 */
import { inflateRawSync, unzipSync } from 'node:zlib';
import { alfa, arquivo, brancos, data, dataIso, hora, lerData, lerValor, linhas, num, percentual, pos, registro, valor } from '../boleto/cnab.js';
import { digitos } from '../boleto/febraban.js';
import type { Boleto, ClienteApi, Comando, Conta, DadosComando, ItemRemessa, ModuloBanco, Ocorrencia, RespostaHttp, ResultadoRegistro, Retorno, TipoOcorrencia } from '../boleto/tipos.js';

// ---------------------------------------------------------------------------
// Dados da conta
// ---------------------------------------------------------------------------

const codigoCliente = (c: Conta) => digitos(c.beneficiario) + digitos(c.beneficiarioDv);
const modalidade = (c: Conta) => num(c.config?.modalidade || '01', 2, 'Modalidade');
const carteira = (c: Conta) => digitos(c.carteira).replace(/^0+/, '');
const numeroCliente = (c: Conta) => Number(digitos(c.config?.numeroCliente) || codigoCliente(c));
/** Nosso número como a API do Sicoob usa: com o DV no fim, sem zeros à esquerda */
const nossoNumeroApi = (b: Boleto) => Number(digitos(b.nossoNumero) + digitos(b.nossoNumeroDv));

/** DV do nosso número: cooperativa(4) + cliente(10) + nosso número(7), pesos 3197; 10 e 11 viram 0 */
function dvNossoNumero(c: Conta, numero: string): string {
  const base = num(c.agencia, 4, 'Cooperativa') + num(codigoCliente(c), 10, 'Código do cliente') + num(numero, 7, 'Nosso número');
  let soma = 0;
  for (let i = 0; i < base.length; i++) soma += Number(base[i]) * Number('319731973197319731973'[i]);
  const dv = 11 - (soma % 11);
  return String(dv > 9 ? 0 : dv);
}

function exigir<T>(v: T | undefined | null, oque: string): T {
  if (v === undefined || v === null || v === '') throw new Error(`Sicoob: falta ${oque}.`);
  return v;
}

const SEM_ALTERAR_VALOR =
  'O Sicoob não tem alteração de valor do boleto no ACBr (nem código de movimento no CNAB 240, nem chamada na API v3). Baixe o boleto e registre outro.';

// ---------------------------------------------------------------------------
// Tabelas do ACBr (CodOcorrenciaToTipo, TipoOcorrenciaToDescricao, CodMotivoRejeicaoToDescricao)
// ---------------------------------------------------------------------------

/** "cc texto" por linha -> { cc: texto } */
const tabela = (t: string) => Object.fromEntries(t.trim().split('\n').map((l) => [l.trim().slice(0, 2), l.trim().slice(3)]));

/** Código de movimento do retorno -> "tipo descrição" */
const OCORRENCIAS = tabela(`
  02 entrada Confirmação de entrada do título
  03 rejeicao Comando recusado
  04 outra Transferência de carteira - entrada
  05 outra Liquidação sem registro / transferência de carteira - baixa
  06 liquidacao Liquidação normal
  07 alteracao Confirmação de concessão de desconto
  08 alteracao Confirmação de cancelamento de desconto
  09 baixa Baixa de título
  10 baixa Baixa solicitada
  11 outra Título em ser
  12 alteracao Abatimento concedido
  13 alteracao Abatimento cancelado
  14 alteracao Alteração de vencimento
  15 liquidacao Liquidação em cartório
  17 liquidacao Liquidação após baixa ou de título não registrado
  19 protesto Confirmação da instrução de protesto
  20 protesto Confirmação da instrução de sustação de protesto
  21 protesto Confirmação da instrução de protesto
  23 protesto Encaminhado a protesto
  24 protesto Instrução de protesto rejeitada, sustada ou pendente
  25 baixa Baixado e protestado
  26 rejeicao Instrução rejeitada
  27 alteracao Confirmação de alteração de dados
  28 tarifa Débito de tarifas/custas
  30 rejeicao Alteração de dados rejeitada
  33 alteracao Confirmação da alteração dos dados do rateio de crédito
  37 outra Envio de e-mail/SMS rejeitado
  38 alteracao Confirmação de alteração do prazo limite de recebimento
  39 alteracao Confirmação de dispensa de prazo limite de recebimento
  44 outra Cheque devolvido
  45 outra Cheque compensado
  50 outra Título pago com cheque pendente de liquidação
  54 baixa Baixa de título negativado sem protesto
  55 alteracao Confirmação do pedido de dispensa de multa
  56 alteracao Confirmação do pedido de cobrança de multa
  60 alteracao Juros dispensados
  80 outra Confirmação da instrução de negativação
  98 protesto Protestado
  99 rejeicao Registro recusado
`);

/** Motivos das ocorrências 02, 03, 26 e 30 */
const MOTIVOS_REJEICAO = tabela(`
  01 Código do banco inválido
  02 Código do registro detalhe inválido
  03 Código do segmento inválido
  04 Código de movimento não permitido para a carteira
  05 Código de movimento inválido
  06 Tipo/número de inscrição do beneficiário inválidos
  07 Agência/conta/DV inválido
  08 Nosso número inválido
  09 Nosso número duplicado
  10 Carteira inválida
  11 Forma de cadastramento do título inválida
  12 Tipo de documento inválido
  13 Identificação da emissão do boleto inválida
  14 Identificação da distribuição do boleto inválida
  15 Características da cobrança incompatíveis
  16 Data de vencimento inválida
  17 Data de vencimento anterior à data de emissão
  18 Vencimento fora do prazo de operação
  19 Título a cargo de bancos correspondentes com vencimento inferior a XX dias
  20 Valor do título inválido
  21 Espécie do título inválida
  22 Espécie do título não permitida para a carteira
  23 Aceite inválido
  24 Data da emissão inválida
  25 Data da emissão posterior à data de entrada
  26 Código de juros de mora inválido
  27 Valor/taxa de juros de mora inválido
  28 Código do desconto inválido
  29 Valor do desconto maior ou igual ao valor do título
  30 Desconto a conceder não confere
  31 Concessão de desconto - já existe desconto anterior
  32 Valor do IOF inválido
  33 Valor do abatimento inválido
  34 Valor do abatimento maior ou igual ao valor do título
  35 Valor a conceder não confere
  36 Concessão de abatimento - já existe abatimento anterior
  37 Código para protesto inválido
  38 Prazo para protesto inválido
  39 Pedido de protesto não permitido para o título
  40 Título com ordem de protesto emitida
  41 Pedido de cancelamento/sustação para título sem instrução de protesto
  42 Código para baixa/devolução inválido
  43 Prazo para baixa/devolução inválido
  44 Código da moeda inválido
  45 Nome do pagador não informado
  46 Tipo/número de inscrição do pagador inválidos
  47 Endereço do pagador não informado
  48 CEP inválido
  49 CEP sem praça de cobrança (não localizado)
  50 CEP referente a um banco correspondente
  51 CEP incompatível com a unidade da federação
  52 Unidade da federação inválida
  53 Tipo/número de inscrição do sacador/avalista inválidos
  54 Sacador/avalista não informado
  55 Nosso número no banco correspondente não informado
  56 Código do banco correspondente não informado
  57 Código da multa inválido
  58 Data da multa inválida
  59 Valor/percentual da multa inválido
  60 Movimento para título não cadastrado
  61 Alteração da agência cobradora/DV inválida
  62 Tipo de impressão inválido
  63 Entrada para título já cadastrado
  64 Número da linha inválido
  65 Código do banco para débito inválido
  66 Agência/conta/DV para débito inválido
  67 Dados para débito incompatíveis com a identificação da emissão do boleto
  68 Débito automático agendado
  69 Débito não agendado - erro nos dados da remessa
  70 Débito não agendado - pagador não consta do cadastro de autorizante
  71 Débito não agendado - beneficiário não autorizado pelo pagador
  72 Débito não agendado - beneficiário não participa da modalidade débito automático
  73 Débito não agendado - código de moeda diferente de real (R$)
  74 Débito não agendado - data de vencimento inválida
  75 Débito não agendado, conforme seu pedido, título não registrado
  76 Débito não agendado, tipo/número de inscrição do debitado inválido
  77 Transferência para desconto não permitida para a carteira do título
  78 Data inferior ou igual ao vencimento para débito automático
  79 Data de juros de mora inválida
  80 Data do desconto inválida
  81 Tentativas de débito esgotadas - baixado
  82 Tentativas de débito esgotadas - pendente
  83 Limite excedido
  84 Número de autorização inexistente
  85 Título com pagamento vinculado
  86 Seu número inválido
  87 E-mail/SMS enviado
  88 E-mail lido
  89 E-mail/SMS devolvido - endereço de e-mail ou número do celular incorreto
  90 E-mail devolvido - caixa postal cheia
  91 E-mail/número do celular do pagador não informado
  92 Pagador optante por boleto eletrônico - e-mail não enviado
  93 Código para emissão de boleto não permite envio de e-mail
  94 Código da carteira inválido para envio de e-mail
  95 Contrato não permite o envio de e-mail
  96 Número de contrato inválido
  97 Rejeição da alteração do prazo limite de recebimento
  98 Rejeição de dispensa de prazo limite de recebimento
  99 Rejeição da alteração do número do título dado pelo beneficiário
  A1 Rejeição da alteração do número controle do participante
  A2 Rejeição da alteração dos dados do pagador
  A3 Rejeição da alteração dos dados do sacador/avalista
  A4 Pagador DDA
  A5 Registro rejeitado - título já liquidado
  A6 Código do convenente inválido ou encerrado
  A7 Título já se encontra na situação pretendida
  A8 Valor do abatimento inválido para cancelamento
  A9 Não autoriza pagamento parcial
  B1 Autoriza recebimento parcial
  B2 Valor nominal do título conflitante
  B3 Tipo de pagamento inválido
  B4 Valor máximo/percentual inválido
  B5 Valor mínimo/percentual inválido
`);

/** Motivos (canal/forma) das ocorrências 06, 09, 17 e 25 */
const MOTIVOS_LIQUIDACAO_BAIXA = tabela(`
  01 Por saldo
  02 Por conta
  03 Liquidação no guichê de caixa em dinheiro
  04 Compensação eletrônica
  05 Compensação convencional
  06 Por meio eletrônico
  07 Após feriado local
  08 Em cartório
  09 Comandada banco
  10 Comandada cliente arquivo
  11 Comandada cliente on-line
  12 Decurso de prazo - cliente
  13 Decurso de prazo - banco
  14 Protestado
  15 Título excluído
  30 Liquidação no guichê de caixa em cheque
  31 Liquidação em banco correspondente
  32 Liquidação em terminal de autoatendimento
  33 Liquidação na internet (home banking)
  34 Liquidado office banking
  35 Liquidado correspondente em dinheiro
  36 Liquidado correspondente em cheque
  37 Liquidado por central de atendimento (telefone)
`);

/** Motivos da ocorrência 28 (débito de tarifas/custas) */
const MOTIVOS_TARIFA = tabela(`
  01 Tarifa de extrato de posição
  02 Tarifa de manutenção de título vencido
  03 Tarifa de sustação
  04 Tarifa de protesto
  05 Tarifa de outras instruções
  06 Tarifa de outras ocorrências
  07 Tarifa de envio de duplicata ao pagador
  08 Custas de protesto
  09 Custas de sustação de protesto
  10 Custas de cartório distribuidor
  11 Custas de edital
  12 Tarifa sobre devolução de título vencido
  13 Tarifa sobre registro cobrada na baixa/liquidação
  14 Tarifa sobre reapresentação automática
  15 Tarifa sobre rateio de crédito
  16 Tarifa sobre informações via fax
  17 Tarifa sobre prorrogação de vencimento
  18 Tarifa sobre alteração de abatimento/desconto
  19 Tarifa sobre arquivo mensal (em ser)
  20 Tarifa sobre emissão de boleto pré-emitido pelo banco
`);

function tabelaDeMotivos(codigo: string): Record<string, string> | null {
  if (['02', '03', '26', '30'].includes(codigo)) return MOTIVOS_REJEICAO;
  if (['06', '09', '17', '25'].includes(codigo)) return MOTIVOS_LIQUIDACAO_BAIXA;
  if (codigo === '28') return MOTIVOS_TARIFA;
  return null;
}

/** Espécie (sigla) -> código do segmento P.107-108, como o ACBr; o que não estiver aqui sai 99 */
const ESPECIES = ['CH', 'DM', 'DMI', 'DS', 'DSI', 'DR', 'LC', 'NCC', 'NCE', 'NCI', 'NCR', 'NP', 'NPR', 'TM', 'TS', 'NS', 'RC', 'FAT', 'ND', 'AP', 'ME', 'PC', 'NF', 'DD'];
function especie(sigla: string): string {
  const s = String(sigla || 'DM').trim().toUpperCase();
  if (s === 'BDP') return '32';
  const i = ESPECIES.indexOf(s);
  return i < 0 ? '99' : String(i + 1).padStart(2, '0');
}

/**
 * Comando -> código de movimento da remessa (GerarRegistroTransacao240 do ACBr).
 * Sustar protesto = 11 (toRemessaCancelarInstrucaoProtesto, "sustar e manter em carteira");
 * o 10 do ACBr é sustar E baixar.
 */
const MOVIMENTO: Record<Comando, string | null> = {
  registrar: '01',
  baixar: '02',
  conceder_abatimento: '04',
  cancelar_abatimento: '05',
  alterar_vencimento: '06',
  protestar: '09',
  sustar_protesto: '11',
  alterar_valor: null,
};

// ---------------------------------------------------------------------------
// CNAB 240
// ---------------------------------------------------------------------------

function remessa(conta: Conta, numeroRemessa: number, itens: ItemRemessa[], agora: Date): string {
  const hoje = data(dataIso(agora));
  const cnpj = conta.empresa.cnpj;
  const inscricao = digitos(cnpj).length === 11 ? '1' : '2';
  const ag = num(conta.agencia, 4, 'Cooperativa');
  const agDv = alfa(conta.agenciaDv || '0', 1);
  const cc = num(conta.conta, 12, 'Conta corrente');
  const ccDv = alfa(conta.contaDv || '0', 1);
  const nome = alfa(conta.empresa.razaoSocial, 30);
  const mod = modalidade(conta);

  const saida = [
    // Header de arquivo
    registro(240, '756', '0000', '0', brancos(9), inscricao, num(cnpj, 14, 'CNPJ'), alfa(conta.convenio, 20), '0', ag, agDv, cc, ccDv, '0',
      nome, alfa('SICOOB', 30), brancos(10), '1', hoje, hora(agora), num(numeroRemessa, 6, 'Número da remessa'), '081', '00000', brancos(69)),
    // Header de lote
    registro(240, '756', '0001', '1', 'R', '01', '  ', '040', ' ', inscricao, num(cnpj, 15, 'CNPJ'), brancos(20), '0', ag, agDv, cc, ccDv, ' ',
      nome, brancos(80), num(numeroRemessa, 8, 'Número da remessa'), hoje, '00000000', brancos(33)),
  ];

  let seq = 0;
  let total = 0;
  for (const { comando, boleto: b, dados } of itens) {
    const mov = MOVIMENTO[comando];
    if (!mov) throw new Error(SEM_ALTERAR_VALOR);
    const detalhe = (segmento: string, ...partes: string[]) => registro(240, '756', '0001', '3', num(++seq, 5), segmento, ' ', mov, ...partes);
    const p = b.pagador;
    const vencimento = comando === 'alterar_vencimento' ? exigir(dados?.vencimento, 'o novo vencimento') : b.dataVencimento;
    const abatimento = comando === 'conceder_abatimento' ? exigir(dados?.abatimento ?? b.abatimento, 'o valor do abatimento') : b.abatimento;
    total += b.valor;

    // Segmento P: juros "2" = taxa mensal (o percentual vai com 2 casas), desconto "1" = valor fixo até a data,
    // protesto "1" = dias corridos / "3" = não protestar. Código de baixa "0" e dias em branco: o ACBr não grava diasBaixa.
    const juros = b.juros?.percentualMensal ? ['2', data(b.juros.data), percentual(b.juros.percentualMensal, 15)] : ['0', data(''), valor(0, 15)];
    const desconto = b.desconto?.valor ? ['1', data(b.desconto.data), valor(b.desconto.valor, 15, 'Desconto')] : ['0', data(''), valor(0, 15)];
    const protesto = b.diasProtesto ? ['1', num(b.diasProtesto, 2, 'Dias para protesto')] : ['3', '00'];
    saida.push(detalhe('P', '0', ag, agDv, cc, ccDv, ' ',
      num(b.nossoNumero + b.nossoNumeroDv, 10, 'Nosso número'), '01', mod, '4', brancos(5),
      num(carteira(conta), 1, 'Carteira'), '0', ' ', '2', '2', alfa(b.seuNumero, 15), data(vencimento), valor(b.valor, 15, 'Valor do título'),
      '00000', ' ', especie(b.especie), alfa(b.aceite || 'N', 1), data(b.dataEmissao),
      ...juros, ...desconto, valor(0, 15), valor(abatimento, 15, 'Abatimento'), alfa(b.seuNumero, 25),
      ...protesto, '0', brancos(3), '09', num(0, 10), ' '));

    // Segmento Q: pagador (sem sacador/avalista)
    saida.push(detalhe('Q', digitos(p.documento).length > 11 ? '2' : '1', num(p.documento, 15, 'CPF/CNPJ do pagador'), alfa(p.nome, 40),
      alfa([p.logradouro, p.numero, p.complemento].filter(Boolean).join(' '), 40), alfa(p.bairro, 15), num(p.cep, 8, 'CEP do pagador'),
      alfa(p.cidade, 15), alfa(p.uf, 2), '0', num(0, 15), brancos(30), brancos(10), '000', brancos(28)));

    // Segmento R: multa "2" = percentual (2 casas)
    const multa = b.multa?.percentual ? ['2', data(b.multa.data), percentual(b.multa.percentual, 15)] : ['0', data(''), valor(0, 15)];
    saida.push(detalhe('R', '0', data(''), valor(0, 15), '0', data(''), valor(0, 15), ...multa, brancos(110),
      '00000000', '000', '00000', ' ', num(0, 12), ' ', ' ', '0', brancos(9)));

    // Segmento S: mensagens (tipo de impressão 3). O ACBr junta o texto e corta de 40 em 40;
    // aqui cada mensagem vai numa das 5 linhas de 40.
    saida.push(detalhe('S', '3', ...[0, 1, 2, 3, 4].map((i) => alfa(b.mensagens?.[i], 40)), brancos(22)));
  }

  saida.push(
    registro(240, '756', '0001', '5', brancos(9), num(seq + 2, 6), num(itens.length, 6), valor(total, 17, 'Total da remessa'),
      num(0, 6), num(0, 17), num(0, 46), brancos(8), brancos(117)),
    registro(240, '756', '9999', '9', brancos(9), '000001', num(seq + 4, 6), '000000', brancos(205)),
  );
  return arquivo(saida);
}

function retorno(conteudo: string, conta: Conta): Retorno {
  const ls = linhas(conteudo);
  const h = ls[0] ?? '';
  if (pos(h, 1, 3) !== '756' || pos(h, 8, 8) !== '0') throw new Error('O arquivo não é um retorno CNAB 240 do Sicoob.');
  if (Number(pos(h, 53, 57)) !== Number(digitos(conta.agencia)) || Number(pos(h, 59, 70)) !== Number(digitos(conta.conta))) {
    throw new Error(`O retorno é da cooperativa ${Number(pos(h, 53, 57))}, conta ${Number(pos(h, 59, 70))}: não é desta conta.`);
  }
  const dataArquivo = lerData(h, 144, 151);
  const ocorrencias: Ocorrencia[] = [];
  let atual: Ocorrencia | undefined;

  for (const l of ls) {
    if (pos(l, 8, 8) !== '3') continue;
    const segmento = pos(l, 14, 14);
    if (segmento === 'T') {
      const codigo = pos(l, 16, 17);
      const [tipo, ...descricao] = (OCORRENCIAS[codigo] ?? `outra Ocorrência ${codigo}`).split(' ');
      const tabelaMotivos = tabelaDeMotivos(codigo);
      const motivos = (pos(l, 214, 223).match(/.{2}/g) ?? [])
        .filter((m) => m.trim() && m !== '00')
        .map((m) => (tabelaMotivos ? `${m} - ${tabelaMotivos[m] ?? 'outros motivos'}` : m));
      atual = {
        nossoNumero: pos(l, 40, 46), // 7 dígitos, sem o DV (T.47)
        seuNumero: pos(l, 59, 73).trim() || undefined,
        tipo: tipo as TipoOcorrencia,
        codigoBanco: codigo,
        motivo: descricao.join(' ') + (motivos.length ? `: ${motivos.join('; ')}` : ''),
        dataOcorrencia: dataArquivo, // trocada pela data do segmento U
        valorTitulo: lerValor(l, 82, 96),
        valorTarifa: lerValor(l, 199, 213),
      };
      ocorrencias.push(atual);
    } else if (segmento === 'U' && atual) {
      atual.valorJuros = lerValor(l, 18, 32);
      atual.valorDesconto = lerValor(l, 33, 47);
      atual.valorAbatimento = lerValor(l, 48, 62);
      atual.valorPago = lerValor(l, 78, 92);
      atual.dataOcorrencia = lerData(l, 138, 145) || dataArquivo;
      atual.dataCredito = lerData(l, 146, 153) || undefined;
      atual = undefined;
    }
  }
  return { numero: Number(pos(h, 158, 163)) || undefined, dataArquivo: dataArquivo || undefined, ocorrencias };
}

// ---------------------------------------------------------------------------
// API Cobrança Bancária v3
// ---------------------------------------------------------------------------

const URL_API: Record<1 | 2, string> = {
  1: 'https://api.sicoob.com.br/cobranca-bancaria/v3',
  2: 'https://sandbox.sicoob.com.br/sicoob/sandbox/cobranca-bancaria/v3',
};
const URL_TOKEN = 'https://auth.sicoob.com.br/auth/realms/cooperado/protocol/openid-connect/token';
/** O sandbox do Sicoob não emite token: o ACBr usa este token fixo + o client_id do sandbox */
const TOKEN_SANDBOX = '1301865f-c6bc-38f3-9f49-666dbcfc59c3';
/** O ACBr deixa o escopo por conta do usuário; estes são os da API de cobrança v3 */
const ESCOPOS = 'boletos_inclusao boletos_consulta boletos_alteracao';
const ESPERA_MOVIMENTO_MS = 60_000;
const INTERVALO_MOVIMENTO_MS = 5_000;

const sucesso = (r: RespostaHttp) => r.status >= 200 && r.status < 300;

/** OAuth: client_id no form, sem secret, com TLS mútuo (DefinirParamOAuth do ACBr). Toda chamada leva o client_id no cabeçalho. */
async function chamar(cli: ClienteApi, conta: Conta, metodo: 'GET' | 'POST' | 'PATCH', caminho: string, operacao: string, corpo?: unknown) {
  const token = conta.ambiente === 1 ? await cli.oauth({ url: URL_TOKEN, escopo: ESCOPOS, autenticacao: 'corpo' }) : TOKEN_SANDBOX;
  return cli.pedir({
    metodo,
    url: URL_API[conta.ambiente] + caminho,
    corpo,
    operacao,
    cabecalhos: { Authorization: `Bearer ${token}`, client_id: cli.credenciais.clientId },
  });
}

/** Erro do Sicoob ({ mensagens: [{ codigo, mensagem }] }; credencial inválida vem em texto puro) */
function falha(r: RespostaHttp, acao: string): Error {
  const c = r.corpo;
  const mensagens = Array.isArray(c?.mensagens) ? c.mensagens.map((m: any) => [m?.codigo, m?.mensagem].filter(Boolean).join(' - ')).filter(Boolean) : [];
  const detalhe = mensagens.join('; ') || c?.message || c?.error_description || c?.error || String(r.texto || '').slice(0, 300) || 'sem detalhe';
  return new Error(`O Sicoob recusou ${acao} (HTTP ${r.status}): ${detalhe}`);
}

/** Nosso número e DV saem do código de barras devolvido (campo livre do ACBr: NN+DV nas posições 34-41) */
function resultado(b: Boleto, res: any): ResultadoRegistro {
  const barras = digitos(res?.codigoBarras);
  return {
    nossoNumero: barras.length === 44 ? barras.slice(33, 40) : b.nossoNumero,
    nossoNumeroDv: barras.length === 44 ? barras[40] : b.nossoNumeroDv,
    codigoBarras: barras || undefined,
    linhaDigitavel: digitos(res?.linhaDigitavel) || undefined,
    pixEmv: res?.qrCode || undefined,
  };
}

async function registrar(cli: ClienteApi, conta: Conta, b: Boleto): Promise<ResultadoRegistro> {
  const p = b.pagador;
  const corpo = {
    numeroCliente: numeroCliente(conta),
    codigoModalidade: Number(modalidade(conta)),
    numeroContaCorrente: Number(digitos(conta.conta) + digitos(conta.contaDv)),
    codigoEspecieDocumento: b.especie || 'DM',
    dataEmissao: b.dataEmissao,
    nossoNumero: nossoNumeroApi(b),
    seuNumero: b.seuNumero,
    identificacaoBoletoEmpresa: b.seuNumero,
    identificacaoEmissaoBoleto: 2, // cliente emite
    identificacaoDistribuicaoBoleto: 2, // cliente distribui
    valor: b.valor,
    dataVencimento: b.dataVencimento,
    numeroParcela: 1,
    aceite: b.aceite === 'A',
    ...(b.diasProtesto ? { codigoProtesto: 1, numeroDiasProtesto: b.diasProtesto } : {}),
    ...(b.desconto?.valor ? { tipoDesconto: 1, dataPrimeiroDesconto: b.desconto.data, valorPrimeiroDesconto: b.desconto.valor } : { tipoDesconto: 0 }),
    ...(b.abatimento ? { valorAbatimento: b.abatimento } : {}),
    ...(b.juros?.percentualMensal
      ? { tipoJurosMora: 2, dataJurosMora: b.juros.data, valorJurosMora: b.juros.percentualMensal }
      : { tipoJurosMora: 3, valorJurosMora: 0 }),
    ...(b.multa?.percentual ? { tipoMulta: 2, dataMulta: b.multa.data, valorMulta: b.multa.percentual } : { tipoMulta: 0, valorMulta: 0 }),
    pagador: {
      numeroCpfCnpj: digitos(p.documento),
      nome: p.nome,
      endereco: [p.logradouro, p.numero].filter(Boolean).join(' '),
      bairro: p.bairro,
      cidade: p.cidade,
      cep: digitos(p.cep),
      uf: p.uf,
      ...(p.email ? { email: p.email } : {}),
    },
    ...(b.mensagens?.some(Boolean) ? { mensagensInstrucao: b.mensagens.filter(Boolean) } : {}),
    gerarPdf: false,
    codigoCadastrarPIX: b.pixHibrido ? 1 : 0,
  };
  const r = await chamar(cli, conta, 'POST', '/boletos', 'registrar', corpo);
  if (!sucesso(r) || !r.corpo?.resultado) throw falha(r, 'o registro do boleto');
  return resultado(b, r.corpo.resultado);
}

async function consultar(cli: ClienteApi, conta: Conta, b: Boleto) {
  const r = await chamar(cli, conta, 'GET',
    `/boletos?numeroCliente=${numeroCliente(conta)}&codigoModalidade=${Number(modalidade(conta))}&nossoNumero=${nossoNumeroApi(b)}`, 'consultar');
  // 204 = "processada com êxito e sem conteúdo": é assim que o Sicoob diz que não achou (ACBr)
  if (r.status === 204 || r.status === 404 || (sucesso(r) && !r.corpo?.resultado)) return { registrado: false };
  if (!sucesso(r)) throw falha(r, 'a consulta do boleto');
  return { registrado: true, resultado: resultado(b, r.corpo.resultado) };
}

async function instruir(cli: ClienteApi, conta: Conta, b: Boleto, comando: Exclude<Comando, 'registrar'>, dados?: DadosComando): Promise<void> {
  const nn = nossoNumeroApi(b);
  const base = { numeroCliente: numeroCliente(conta), codigoModalidade: Number(modalidade(conta)) };
  let pedido: ['POST' | 'PATCH', string, object];
  switch (comando) {
    case 'baixar': pedido = ['POST', `/boletos/${nn}/baixar`, base]; break;
    case 'protestar': pedido = ['POST', `/boletos/${nn}/protestos`, base]; break;
    case 'sustar_protesto': pedido = ['PATCH', `/boletos/${nn}/protestos`, base]; break;
    case 'alterar_vencimento':
      pedido = ['PATCH', `/boletos/${nn}`, { ...base, prorrogacaoVencimento: { dataVencimento: exigir(dados?.vencimento, 'o novo vencimento') } }];
      break;
    case 'conceder_abatimento':
      pedido = ['PATCH', `/boletos/${nn}`, { ...base, abatimento: { valorAbatimento: exigir(dados?.abatimento ?? b.abatimento, 'o valor do abatimento') } }];
      break;
    // O ACBr manda o ValorAbatimento do título; para cancelar, vai zero
    case 'cancelar_abatimento': pedido = ['PATCH', `/boletos/${nn}`, { ...base, abatimento: { valorAbatimento: 0 } }]; break;
    case 'alterar_valor': throw new Error(SEM_ALTERAR_VALOR);
    default: throw new Error(`Comando "${comando}" não atendido pelo Sicoob.`);
  }
  const r = await chamar(cli, conta, pedido[0], pedido[1], comando, pedido[2]);
  if (!sucesso(r)) throw falha(r, `a instrução "${comando}"`);
}

/** O arquivo da movimentação vem em base64, compactado (ZIP, gzip ou zlib, como o UnZip do ACBr) */
function descompactar(base64: string): string {
  const b = Buffer.from(base64, 'base64');
  if (b.length > 30 && b.readUInt32LE(0) === 0x04034b50) {
    // ZIP: só o primeiro arquivo, que é o JSON
    const metodo = b.readUInt16LE(8);
    const inicio = 30 + b.readUInt16LE(26) + b.readUInt16LE(28);
    return (metodo === 8 ? inflateRawSync(b.subarray(inicio)) : b.subarray(inicio, inicio + b.readUInt32LE(18))).toString('utf8');
  }
  if ((b[0] === 0x1f && b[1] === 0x8b) || b[0] === 0x78) return unzipSync(b).toString('utf8');
  return b.toString('utf8');
}

const dia = (v: unknown) => /^\d{4}-\d{2}-\d{2}/.exec(String(v ?? ''))?.[0] ?? '';
const numero = (v: unknown) => Number(v) || 0;
function somarDias(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return dataIso(d);
}

/** Um item do JSON da movimentação (campos lidos como no LerListaRetorno do ACBr) */
function ocorrenciaMovimento(tipoMovimento: 5 | 6, x: any): Ocorrencia {
  const barras = digitos(x?.codigoBarras);
  // Sem código de barras, supõe numeroTitulo com o DV no fim, como o nossoNumero da API
  const nnDv = barras.length === 44 ? barras.slice(33, 41) : digitos(x?.numeroTitulo);
  const liquidacao = tipoMovimento === 5;
  return {
    nossoNumero: nnDv.slice(0, -1).padStart(7, '0'),
    seuNumero: String(x?.seuNumero ?? '').trim() || undefined,
    tipo: liquidacao ? 'liquidacao' : 'baixa',
    codigoBanco: String(x?.siglaMovimento || (liquidacao ? 'LIQUI' : 'BAIX')),
    motivo: (liquidacao ? 'Liquidação' : 'Baixa') + (x?.tipoOpFinanceira ? ` (tipo de operação ${x.tipoOpFinanceira})` : ''),
    dataOcorrencia: dia(x?.dataLiquidacao) || dia(x?.dataInicioMovimento),
    dataCredito: dia(x?.dataPrevisaoCredito) || undefined,
    valorTitulo: numero(x?.valorTitulo),
    valorPago: numero(x?.valorLiquido), // o ACBr põe valorLiquido no ValorPago
    valorJuros: numero(x?.valorMora),
    valorDesconto: numero(x?.valorDesconto),
    valorAbatimento: numero(x?.valorAbatimento),
    valorTarifa: numero(x?.valorTarifaMovimento),
  };
}

/** Consulta a solicitação até o Sicoob liberar os arquivos ou estourar o prazo */
async function esperarArquivos(cli: ClienteApi, conta: Conta, codigo: string, limite: number): Promise<string[]> {
  for (;;) {
    const r = await chamar(cli, conta, 'GET', `/boletos/movimentacoes?numeroCliente=${numeroCliente(conta)}&codigoSolicitacao=${codigo}`, 'movimento');
    if (!sucesso(r)) throw falha(r, 'a consulta da movimentação');
    const res = r.corpo?.resultado ?? {};
    if (Array.isArray(res.idArquivos) && res.idArquivos.length) return res.idArquivos.map(String);
    if (res.quantidadeTotalRegistros !== undefined && Number(res.quantidadeTotalRegistros) === 0) return [];
    if (Date.now() + INTERVALO_MOVIMENTO_MS > limite) {
      throw new Error(`O Sicoob não liberou a movimentação (solicitação ${codigo}) em ${ESPERA_MOVIMENTO_MS / 1000} s` +
        `${res.mensagem ? `: ${res.mensagem}` : ''}. Tente de novo em alguns minutos.`);
    }
    await new Promise((ok) => setTimeout(ok, INTERVALO_MOVIMENTO_MS));
  }
}

/**
 * Liquidações (tipoMovimento 5) e baixas (6). A API é assíncrona: solicita, consulta a situação
 * até sair a lista de arquivos e baixa cada um. O período de cada solicitação é de no máximo 2 dias,
 * então de..ate vira janelas de 2 dias; todas são pedidas antes de esperar, com um prazo único.
 */
async function movimento(cli: ClienteApi, conta: Conta, de: string, ate: string): Promise<Ocorrencia[]> {
  const limite = Date.now() + ESPERA_MOVIMENTO_MS;
  const pedidos: { tipo: 5 | 6; codigo: string }[] = [];
  for (let inicio = de; inicio <= ate; inicio = somarDias(inicio, 2)) {
    const fim = somarDias(inicio, 1) < ate ? somarDias(inicio, 1) : ate;
    for (const tipo of [5, 6] as const) {
      const r = await chamar(cli, conta, 'POST', '/boletos/movimentacoes', 'movimento',
        { numeroCliente: numeroCliente(conta), tipoMovimento: tipo, dataInicial: inicio, dataFinal: fim });
      const codigo = r.corpo?.resultado?.codigoSolicitacao;
      if (!sucesso(r) || !codigo) throw falha(r, 'a solicitação de movimentação');
      pedidos.push({ tipo, codigo: String(codigo) });
    }
  }

  const ocorrencias: Ocorrencia[] = [];
  for (const { tipo, codigo } of pedidos) {
    for (const id of await esperarArquivos(cli, conta, codigo, limite)) {
      const r = await chamar(cli, conta, 'GET',
        `/boletos/movimentacoes/download?numeroCliente=${numeroCliente(conta)}&codigoSolicitacao=${codigo}&idArquivo=${id}`, 'movimento');
      const arq = r.corpo?.resultado?.arquivo;
      if (!sucesso(r) || !arq) throw falha(r, 'o download da movimentação');
      const itens = JSON.parse(descompactar(arq));
      for (const x of Array.isArray(itens) ? itens : []) ocorrencias.push(ocorrenciaMovimento(tipo, x));
    }
  }
  return ocorrencias;
}

// ---------------------------------------------------------------------------

export const sicoob: ModuloBanco = {
  codigo: '756',
  nome: 'Sicoob',

  validarConta(conta) {
    const erros: string[] = [];
    const ag = digitos(conta.agencia);
    const cod = codigoCliente(conta);
    const cc = digitos(conta.conta);
    if (!ag || ag.length > 4) erros.push('Informe a cooperativa (agência) com até 4 dígitos.');
    if (String(conta.agenciaDv ?? '').trim().length > 1) erros.push('O dígito da agência (no Sicoob, o número do posto) tem 1 posição.');
    if (!cod) erros.push('Informe o código do cliente (beneficiário) do Sicoob.');
    else if (cod.length > 7) erros.push('O código do cliente, com o DV, tem no máximo 7 dígitos no código de barras do Sicoob.');
    if (!cc || cc.length > 12) erros.push('Informe a conta corrente com até 12 dígitos.');
    if (String(conta.contaDv ?? '').trim().length > 1) erros.push('O dígito da conta tem 1 posição.');
    if (!['1', '3'].includes(carteira(conta))) erros.push('A carteira do Sicoob deve ser 1 ou 3 (a carteira 9 não é atendida).');
    if (conta.config?.modalidade && !/^\d{1,2}$/.test(conta.config.modalidade.trim())) erros.push('A modalidade tem até 2 dígitos (01 = simples com registro).');
    if (conta.config?.numeroCliente && !/^\d+$/.test(conta.config.numeroCliente.trim())) erros.push('O número do cliente da API só tem dígitos.');
    if (![11, 14].includes(digitos(conta.empresa?.cnpj).length)) erros.push('O CNPJ/CPF da empresa beneficiária é inválido.');
    if (conta.canal === 'remessa' && conta.layoutCnab === '400') erros.push('O Sicoob neste sistema só gera CNAB 240.');
    return erros;
  },

  nossoNumero(conta, sequencial) {
    if (!(sequencial >= 1)) throw new Error(`Sequencial do nosso número inválido: ${sequencial}.`);
    const numero = num(sequencial, 7, 'Nosso número do Sicoob');
    return { numero, dv: dvNossoNumero(conta, numero) };
  },

  nossoNumeroImpresso: (conta, numero, dv) => `${num(numero, 7, 'Nosso número')}-${dv}`,

  /** carteira(1) + cooperativa(4) + modalidade(2) + cliente(7) + nosso número com DV(8) + parcela(3) */
  campoLivre: (conta, numero, dv) =>
    num(carteira(conta), 1, 'Carteira') + num(conta.agencia, 4, 'Cooperativa') + modalidade(conta) +
    num(codigoCliente(conta), 7, 'Código do cliente') + num(numero, 7, 'Nosso número') + num(dv, 1, 'DV do nosso número') + '001',

  agenciaCodigoBeneficiario(conta) {
    const cod = codigoCliente(conta);
    return `${digitos(conta.agencia)}/${cod.slice(0, -1)}-${cod.slice(-1)}`;
  },

  carteiraImpressa: (conta) => carteira(conta),

  cnab240: { remessa, retorno },
  api: { registrar, consultar, instruir, movimento },
};

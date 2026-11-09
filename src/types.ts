export interface Usuario {
  id: number;
  empresa_id: number;
  nome: string;
  email: string;
  cargo?: string;
}

/** Empresa do ERP (sys_empresas): é o beneficiário dos boletos */
export interface Empresa {
  id: number;
  cnpj: string;
  razao_social: string;
  nome_fantasia: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  telefone: string | null;
  email: string | null;
  ativo?: number;
}

export interface Banco {
  codigo: string;
  nome: string;
}

/** Padrões do boleto e campos próprios de cada banco (ban_contas.config) */
export interface ConfigConta {
  variacao?: string;
  modalidade?: string;
  numeroCliente?: string;
  especie?: string;
  aceite?: 'A' | 'N';
  multaPercentual?: number;
  jurosMensalPercentual?: number;
  diasProtesto?: number;
  diasBaixa?: number;
  instrucoes?: string;
  localPagamento?: string;
  pixHibrido?: boolean;
  modeloImpressao?: 'folha' | 'carne';
  [campo: string]: unknown;
}

export interface Conta {
  id: number;
  descricao: string;
  banco_codigo: string;
  banco_nome: string;
  agencia: string;
  agencia_dv: string | null;
  conta: string;
  conta_dv: string | null;
  beneficiario: string | null;
  beneficiario_dv: string | null;
  convenio: string | null;
  carteira: string | null;
  layout_cnab: string | null;
  canal: 'remessa' | 'api';
  ambiente: number;
  config: ConfigConta;
  ultimo_nosso_numero: number;
  ultima_remessa: number;
  api_consultado_ate: string | null;
  ativo: number;
  tem_credenciais: number;
  certificado_nome: string | null;
  certificado_validade: string | null;
  boletos_remessa: number;
  instrucoes_remessa: number;
}

export interface Pagador {
  documento: string;
  nome: string;
  logradouro: string;
  numero?: string;
  complemento?: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
  email?: string;
}

/** O que a tela (e o módulo do ERP) manda para emitir */
export interface PedidoBoleto {
  referencia?: string | null;
  contaId: number;
  seuNumero?: string;
  dataVencimento: string;
  valor: number;
  pagador: Pagador;
  multa?: { percentual: number } | null;
  juros?: { percentualMensal: number } | null;
  desconto?: { valor: number; data: string } | null;
  mensagens?: string[];
  canal?: 'remessa' | 'api';
}

export interface BoletoLista {
  id: number;
  conta_id: number;
  conta: string;
  referencia: string | null;
  ambiente: number;
  canal: 'remessa' | 'api';
  situacao: string;
  nosso_numero: string | null;
  nosso_numero_dv: string | null;
  seu_numero: string;
  data_emissao: string;
  data_vencimento: string;
  valor: string;
  pagador_documento: string;
  pagador_nome: string;
  linha_digitavel: string | null;
  remessa_id: number | null;
  data_pagamento: string | null;
  data_credito: string | null;
  valor_pago: string | null;
  codigo_status: string | null;
  motivo: string | null;
  criado_em: string;
}

export interface Ocorrencia {
  id: number;
  conta_id: number;
  boleto_id: number | null;
  nosso_numero: string;
  origem: string;
  retorno_id: number | null;
  tipo: string;
  codigo_banco: string | null;
  motivo: string | null;
  data_ocorrencia: string;
  data_credito: string | null;
  valor_pago: string | null;
  valor_juros: string | null;
  valor_desconto: string | null;
  valor_tarifa: string | null;
  criado_em: string;
  referencia?: string | null;
  pagador_nome?: string | null;
}

export interface Instrucao {
  id: number;
  tipo: string;
  dados: any;
  canal: string;
  situacao: string;
  remessa_id: number | null;
  motivo: string | null;
  criado_em: string;
  atualizado_em: string | null;
}

/** GET /boletos/:id (o mesmo que o módulo recebe, mais o histórico) */
export interface BoletoDetalhe {
  id: number;
  referencia: string | null;
  contaId: number;
  situacao: string;
  canal: string;
  ambiente: number;
  nossoNumero: string | null;
  nossoNumeroDv: string | null;
  seuNumero: string;
  dataEmissao: string;
  dataVencimento: string;
  valor: number;
  pagadorDocumento: string;
  pagadorNome: string;
  codigoBarras: string | null;
  linhaDigitavelFormatada: string | null;
  pixCopiaECola: string | null;
  remessaId: number | null;
  dataPagamento: string | null;
  dataCredito: string | null;
  valorPago: number | null;
  codigoStatus: string | null;
  motivo: string | null;
  dados: any;
  conta: { descricao: string; banco_codigo: string };
  ocorrencias: Ocorrencia[];
  instrucoes: Instrucao[];
}

export interface Remessa {
  id: number;
  conta_id: number;
  conta: string;
  numero: number;
  layout: string;
  nome_arquivo: string;
  qtde_registros: number;
  valor_total: string;
  situacao: string;
  criado_em: string;
}

export interface Retorno {
  id: number;
  conta_id: number;
  conta: string;
  numero: number | null;
  layout: string;
  nome_arquivo: string;
  data_arquivo: string | null;
  qtde_registros: number;
  liquidacoes: number;
  sem_boleto: number;
  criado_em: string;
}

export interface Lancamento {
  id: number;
  conta_id: number;
  conta: string;
  extrato_id: number;
  fitid: string;
  data_lancamento: string;
  valor: string;
  tipo: string | null;
  documento: string | null;
  historico: string | null;
  situacao: 'pendente' | 'conciliado' | 'ignorado';
  referencia_conciliacao: string | null;
  conciliado_em: string | null;
  liquidacoes: number;
}

export interface ChaveApi {
  id: number;
  nome: string;
  prefixo: string;
  ativo: number;
  ultimo_uso: string | null;
  criado_em: string;
}

export interface StatusBanco {
  connected: boolean;
  latencyMs: number;
  version?: string;
  database: string;
  host: string;
  error?: string;
  tabelasFaltando: string[];
}

export interface Painel {
  contagens: {
    boletos: number;
    aguardando: number;
    registrados: number;
    vencidos: number;
    rejeitados: number;
    valor_aberto: number;
    recebido_mes: number;
  };
  pendencias: {
    boletos_remessa: number;
    instrucoes_remessa: number;
    ocorrencias_sem_boleto: number;
    lancamentos_pendentes: number;
  };
  ocorrencias: {
    id: number;
    tipo: string;
    data_ocorrencia: string;
    valor_pago: string | null;
    nosso_numero: string;
    motivo: string | null;
    pagador_nome: string | null;
    referencia: string | null;
  }[];
  erros: { operacao: string; codigo_status: string; motivo: string; criado_em: string }[];
  certificados: { descricao: string; certificado_validade: string }[];
}

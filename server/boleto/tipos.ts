/**
 * Contrato entre o núcleo do BMBancos e os módulos de cada banco
 * (server/bancos/<codigo>.ts). O núcleo cuida de banco de dados, numeração,
 * código de barras FEBRABAN, PDF e rotas; o módulo só sabe o que é do banco:
 * nosso número, campo livre, layout CNAB e a API.
 *
 * Datas sempre "AAAA-MM-DD" (sem hora, sem fuso). Valores em reais (number,
 * 2 casas); quem grava em arquivo converte para centavos com cnab.valor().
 */

/** Empresa dona da conta (sys_empresas): é o beneficiário do boleto */
export interface Beneficiario {
  cnpj: string;
  razaoSocial: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
}

/**
 * Opções da conta guardadas em ban_contas.config (JSON). Módulos de banco podem
 * acrescentar campos opcionais aqui, sempre com comentário dizendo qual banco usa.
 */
export interface ConfigConta {
  /** BB: variação da carteira (ex.: "019") */
  variacao?: string;
  /** Sicoob: modalidade (01 = simples com registro) */
  modalidade?: string;
  /** Sicoob: número do contrato de cobrança na API (numeroCliente) */
  numeroCliente?: string;
  /** Sigla da espécie do título: DM, DS, NP, RC, ... (padrão DM) */
  especie?: string;
  /** A ou N (padrão N) */
  aceite?: 'A' | 'N';
  /** Padrões aplicados quando o módulo não manda (percentuais) */
  multaPercentual?: number;
  jurosMensalPercentual?: number;
  /** Dias corridos após o vencimento; 0 ou vazio = não protestar */
  diasProtesto?: number;
  /** Baixa automática N dias após o vencimento; vazio = padrão do banco */
  diasBaixa?: number;
  /** Texto impresso no campo de instruções (até 4 linhas, separadas por \n) */
  instrucoes?: string;
  /** "Pagável em qualquer banco até o vencimento" se vazio */
  localPagamento?: string;
  /** Pede o PIX do boleto híbrido no registro pela API, quando o banco oferece */
  pixHibrido?: boolean;
  /** PDF: 'folha' (um por A4, padrão) ou 'carne' (três por A4, com canhoto) */
  modeloImpressao?: 'folha' | 'carne';
}

/** Linha de ban_contas pronta para uso */
export interface Conta {
  id: number;
  empresaId: number;
  bancoCodigo: string;
  agencia: string;
  agenciaDv: string;
  conta: string;
  contaDv: string;
  /** Código do beneficiário (antigo cedente) */
  beneficiario: string;
  beneficiarioDv: string;
  convenio: string;
  carteira: string;
  layoutCnab: '240' | '400' | null;
  canal: 'remessa' | 'api';
  /** API do banco: 1 produção, 2 homologação */
  ambiente: 1 | 2;
  config: ConfigConta;
  empresa: Beneficiario;
}

export interface Pagador {
  /** CPF ou CNPJ, só dígitos */
  documento: string;
  nome: string;
  logradouro: string;
  numero?: string;
  complemento?: string;
  bairro: string;
  cidade: string;
  uf: string;
  /** 8 dígitos */
  cep: string;
  email?: string;
}

/** O boleto como o núcleo entrega ao módulo (colunas de ban_boletos + dados JSON) */
export interface Boleto {
  /** Nosso número como o banco identifica, sem DV (o que nossoNumero() devolveu) */
  nossoNumero: string;
  nossoNumeroDv: string;
  /** Número do documento (seu número), até 15 posições */
  seuNumero: string;
  dataEmissao: string;
  dataVencimento: string;
  valor: number;
  pagador: Pagador;
  especie: string;
  aceite: 'A' | 'N';
  /** Multa cobrada a partir de `data` (normalmente o dia seguinte ao vencimento) */
  multa?: { percentual: number; data: string };
  /** Juros de mora ao mês, a partir de `data` */
  juros?: { percentualMensal: number; data: string };
  /** Desconto de `valor` reais para pagamento até `data` */
  desconto?: { valor: number; data: string };
  abatimento?: number;
  diasProtesto?: number;
  diasBaixa?: number;
  /** Até 4 linhas de mensagem ao pagador */
  mensagens?: string[];
  pixHibrido?: boolean;
}

/** Pedidos ao banco: a entrada (registrar) e as instruções depois dela */
export type Comando =
  | 'registrar'
  | 'baixar'
  | 'alterar_vencimento'
  | 'alterar_valor'
  | 'conceder_abatimento'
  | 'cancelar_abatimento'
  | 'protestar'
  | 'sustar_protesto';

/** Dados das instruções: novo vencimento, novo valor ou valor do abatimento */
export interface DadosComando {
  vencimento?: string;
  valor?: number;
  abatimento?: number;
}

export interface ItemRemessa {
  comando: Comando;
  boleto: Boleto;
  dados?: DadosComando;
}

export type TipoOcorrencia = 'entrada' | 'rejeicao' | 'liquidacao' | 'baixa' | 'alteracao' | 'protesto' | 'tarifa' | 'outra';

/** O que o banco disse sobre um boleto (linha de retorno, consulta ou webhook) */
export interface Ocorrencia {
  /** No mesmo formato de Boleto.nossoNumero, para casar com ban_boletos */
  nossoNumero: string;
  seuNumero?: string;
  tipo: TipoOcorrencia;
  /** Código da ocorrência no layout/API do banco */
  codigoBanco: string;
  /** Descrição da ocorrência, com os motivos de rejeição quando houver */
  motivo: string;
  dataOcorrencia: string;
  dataCredito?: string;
  valorTitulo?: number;
  valorPago?: number;
  /** Juros + multa */
  valorJuros?: number;
  valorDesconto?: number;
  valorAbatimento?: number;
  valorTarifa?: number;
}

export interface Retorno {
  /** NSA do arquivo */
  numero?: number;
  dataArquivo?: string;
  ocorrencias: Ocorrencia[];
}

export interface ResultadoRegistro {
  /** Os bancos que numeram pela API devolvem aqui; os demais repetem o enviado */
  nossoNumero: string;
  nossoNumeroDv: string;
  codigoBarras?: string;
  linhaDigitavel?: string;
  pixEmv?: string;
}

export interface Credenciais {
  clientId: string;
  clientSecret: string;
  /** Chave do aplicativo além do OAuth (gw-dev-app-key do BB) */
  chaveAplicacao: string;
}

export interface RespostaHttp {
  status: number;
  /** JSON já lido quando a resposta é JSON; senão o texto */
  corpo: any;
  texto: string;
}

/**
 * Cliente HTTP com TLS mútuo (certificado da conta), log em ban_log e cache
 * de token OAuth. Não lança erro em status 4xx/5xx: o módulo lê o corpo e
 * monta a mensagem do banco. Lança só em falha de rede/tempo esgotado.
 */
export interface ClienteApi {
  credenciais: Credenciais;
  /** Token client_credentials, guardado em memória até 1 minuto antes de vencer */
  oauth(opcoes: {
    url: string;
    escopo?: string;
    /** 'basic' = client_id:client_secret no Authorization; 'corpo' = no form */
    autenticacao: 'basic' | 'corpo';
    /** Campos a mais no form */
    extras?: Record<string, string>;
  }): Promise<string>;
  pedir(opcoes: {
    metodo: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    url: string;
    /** Objeto vira JSON */
    corpo?: unknown;
    cabecalhos?: Record<string, string>;
    /** Nome curto para o log: "registrar", "baixar", "movimento"... */
    operacao: string;
  }): Promise<RespostaHttp>;
}

export interface ApiBanco {
  registrar(cli: ClienteApi, conta: Conta, boleto: Boleto): Promise<ResultadoRegistro>;
  /**
   * Situação do boleto no banco. Usada antes de reenviar um registro que ficou
   * sem resposta: { registrado: false } = pode registrar de novo.
   */
  consultar(cli: ClienteApi, conta: Conta, boleto: Boleto): Promise<{ registrado: boolean; resultado?: ResultadoRegistro; ocorrencia?: Ocorrencia }>;
  /** Instruções depois da entrada (baixar, alterar vencimento etc.) */
  instruir(cli: ClienteApi, conta: Conta, boleto: Boleto, comando: Exclude<Comando, 'registrar'>, dados?: DadosComando): Promise<void>;
  /** Liquidações e baixas de `de` a `ate` (retorno pela API) */
  movimento(cli: ClienteApi, conta: Conta, de: string, ate: string): Promise<Ocorrencia[]>;
}

export interface ModuloBanco {
  codigo: string;
  nome: string;
  /** Problemas no cadastro da conta para este banco (vazio = ok) */
  validarConta(conta: Conta): string[];
  /** Nosso número (sem DV) e DV a partir do sequencial reservado em ban_contas */
  nossoNumero(conta: Conta, sequencial: number): { numero: string; dv: string };
  /** Nosso número como sai impresso no boleto */
  nossoNumeroImpresso(conta: Conta, numero: string, dv: string): string;
  /** Campo livre do código de barras: 25 dígitos */
  campoLivre(conta: Conta, numero: string, dv: string): string;
  /** "Agência / Código do beneficiário" impresso */
  agenciaCodigoBeneficiario(conta: Conta): string;
  carteiraImpressa(conta: Conta): string;
  cnab240: {
    /** Arquivo inteiro, linhas de 240 posições separadas por CRLF e terminado em CRLF */
    remessa(conta: Conta, numeroRemessa: number, itens: ItemRemessa[], agora: Date): string;
    retorno(conteudo: string, conta: Conta): Retorno;
  };
  api: ApiBanco;
}

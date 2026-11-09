-- =====================================================================
-- BMBancos — concentrador de rotinas bancárias (PROPOSTA)
--
-- Boleto (emissão, registro por remessa CNAB ou por API), retorno (arquivo,
-- API ou webhook do banco) e conciliação por OFX. Os módulos do ERP falam
-- com ele só por API, como no BMNFe: mandam uma referência própria
-- ("CR-123", "PDV-456") e nunca recebem dois boletos para a mesma.
--
-- Roda no banco do ERP (bmerp_*), junto com o BMNFe e o BMNFs. O app nunca
-- cria tabelas. Datas de registro (criado_em etc.) são gravadas pelo app na
-- hora de Brasília, não pelo CURRENT_TIMESTAMP do servidor.
--
-- O tenant é a própria sys_empresas: o beneficiário do boleto é a empresa
-- do ERP (razão social, CNPJ e endereço já estão lá). Login pelos usuários
-- do ERP (sys_usuarios), sem tabela de empresas própria.
--
-- Reversão (apaga tudo do BMBancos):
--   DROP TABLE ban_log, ban_chaves_api, ban_ocorrencias, ban_extrato_lancamentos,
--              ban_extratos, ban_retornos, ban_instrucoes, ban_boletos,
--              ban_remessas, ban_credenciais, ban_contas;
-- =====================================================================

-- ---------------------------------------------------------------------
-- Contas de cobrança: uma linha por convênio/carteira. A mesma agência e
-- conta pode ter mais de uma linha (ex.: BB com carteira 17 e 11).
--
-- Os campos que só um banco usa (variação do BB, modalidade do Sicoob,
-- posto e byte do Sicredi, código de transmissão do Santander...) e os
-- padrões do boleto (multa, juros, desconto, dias para protesto e baixa,
-- espécie, aceite, instruções, local de pagamento, chave PIX do boleto
-- híbrido) ficam em config JSON. A tabela bancos do Delphi tem 30 colunas
-- banco_xxx_* para isso; aqui não há migração a cada banco novo.
--
-- Os dois contadores ficam na própria linha e sobem com
--   UPDATE ban_contas SET ultimo_nosso_numero = LAST_INSERT_ID(ultimo_nosso_numero + 1) WHERE id = ?
-- (mesmo padrão do nfe_numeracao): duas emissões simultâneas nunca pegam o
-- mesmo nosso número. Na implantação, digite o último usado no sistema antigo.
-- ---------------------------------------------------------------------
CREATE TABLE ban_contas (
  id                   INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  empresa_id           BIGINT UNSIGNED NOT NULL,
  descricao            VARCHAR(60)     NOT NULL,
  -- código COMPE (cad_bancos.codigo_compe): 001, 033, 104, 237, 341, 748, 756, 077...
  banco_codigo         CHAR(3)         NOT NULL,
  agencia              VARCHAR(5)      NOT NULL,
  agencia_dv           VARCHAR(2)      NULL,
  conta                VARCHAR(12)     NOT NULL,
  conta_dv             VARCHAR(2)      NULL,
  -- código do beneficiário (antigo cedente) e convênio, como o banco chama
  beneficiario         VARCHAR(20)     NULL,
  beneficiario_dv      VARCHAR(2)      NULL,
  convenio             VARCHAR(20)     NULL,
  carteira             VARCHAR(5)      NULL,
  -- 240 ou 400; nulo = esta conta não gera remessa
  layout_cnab          CHAR(3)         NULL,
  -- canal padrão de registro: remessa | api
  canal                VARCHAR(10)     NOT NULL DEFAULT 'remessa',
  -- ambiente da API do banco: 1 produção, 2 homologação (sandbox)
  ambiente             TINYINT         NOT NULL DEFAULT 2,
  config               JSON            NULL,
  ultimo_nosso_numero  BIGINT          NOT NULL DEFAULT 0,
  ultima_remessa       INT             NOT NULL DEFAULT 0,
  -- até onde o retorno por API já foi consultado (cursor da busca periódica)
  api_consultado_ate   DATETIME        NULL,
  ativo                TINYINT(1)      NOT NULL DEFAULT 1,
  criado_em            DATETIME        NOT NULL,
  atualizado_em        DATETIME        NULL,
  PRIMARY KEY (id),
  KEY ix_ban_contas_empresa (empresa_id, ativo),
  CONSTRAINT fk_ban_contas_empresa FOREIGN KEY (empresa_id) REFERENCES sys_empresas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Credenciais da API do banco, separadas de ban_contas para que listar
-- contas nunca traga segredo nem certificado. client_secret e as senhas
-- são gravados cifrados pelo app (AES-256-GCM, chave no .env).
-- Certificado: .pfx (BB, Sicoob) ou PEM com certificado + chave (Inter, Itaú).
-- ---------------------------------------------------------------------
CREATE TABLE ban_credenciais (
  conta_id             INT UNSIGNED    NOT NULL,
  client_id            VARCHAR(200)    NULL,
  client_secret        VARCHAR(1000)   NULL,
  -- chave do aplicativo exigida por alguns bancos além do OAuth (ex.: gw-dev-app-key do BB)
  chave_aplicacao      VARCHAR(500)    NULL,
  certificado_nome     VARCHAR(160)    NULL,
  certificado          LONGBLOB        NULL,
  certificado_senha    VARCHAR(500)    NULL,
  certificado_validade DATETIME        NULL,
  atualizado_em        DATETIME        NULL,
  PRIMARY KEY (conta_id),
  CONSTRAINT fk_ban_credenciais_conta FOREIGN KEY (conta_id) REFERENCES ban_contas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Remessas CNAB geradas. O conteúdo fica gravado: baixar de novo devolve
-- o mesmo arquivo, com o mesmo número sequencial (NSA).
-- Os boletos e instruções entram pela coluna remessa_id deles, marcados
-- num UPDATE só (... SET remessa_id = ? WHERE remessa_id IS NULL ...):
-- duas gerações simultâneas nunca levam o mesmo boleto.
-- ---------------------------------------------------------------------
CREATE TABLE ban_remessas (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id           BIGINT UNSIGNED NOT NULL,
  conta_id             INT UNSIGNED    NOT NULL,
  -- NSA, de ban_contas.ultima_remessa
  numero               INT             NOT NULL,
  layout               CHAR(3)         NOT NULL,
  nome_arquivo         VARCHAR(60)     NOT NULL,
  qtde_registros       INT             NOT NULL DEFAULT 0,
  valor_total          DECIMAL(15,2)   NOT NULL DEFAULT 0,
  conteudo             LONGTEXT        NOT NULL,
  -- gerada | enviada (o usuário baixou/subiu no banco) | cancelada (itens voltam para a fila)
  situacao             VARCHAR(20)     NOT NULL DEFAULT 'gerada',
  usuario_id           BIGINT UNSIGNED NULL,
  criado_em            DATETIME        NOT NULL,
  atualizado_em        DATETIME        NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ban_remessas_numero (conta_id, numero),
  KEY ix_ban_remessas_empresa (empresa_id, criado_em),
  CONSTRAINT fk_ban_remessas_empresa FOREIGN KEY (empresa_id) REFERENCES sys_empresas (id),
  CONSTRAINT fk_ban_remessas_conta FOREIGN KEY (conta_id) REFERENCES ban_contas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Boletos. Mesmo desenho do nfe_documentos: colunas para listar e filtrar,
-- e em dados (JSON) tudo o que o módulo mandou (endereço do pagador, multa,
-- juros, descontos, mensagens, sacador avalista), para montar a remessa,
-- chamar a API e reimprimir o PDF, que não é gravado.
--
-- A referência é a idempotência: mandar a mesma de novo devolve o boleto
-- que existe. O nosso número fica preso a ela, então reenviar depois de
-- um timeout nunca registra um segundo boleto no banco.
-- ---------------------------------------------------------------------
CREATE TABLE ban_boletos (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id           BIGINT UNSIGNED NOT NULL,
  conta_id             INT UNSIGNED    NOT NULL,
  -- referência do módulo de origem ("CR-123"); nula nos boletos feitos na tela
  referencia           VARCHAR(80)     NULL,
  ambiente             TINYINT         NOT NULL DEFAULT 2,
  -- remessa | api
  canal                VARCHAR(10)     NOT NULL,
  -- emitido     gerado, ainda não foi ao banco (no canal remessa, espera a próxima)
  -- processando registro por API em andamento (parado há mais de 2 min: consulta o banco antes de reenviar)
  -- enviado     foi numa remessa, ou a API não deu resposta conclusiva
  -- registrado | rejeitado | liquidado | baixado
  -- cancelado   cancelado antes de ir ao banco (não precisa de baixa)
  situacao             VARCHAR(20)     NOT NULL DEFAULT 'emitido',
  -- nulo até o registro nos bancos que numeram pela API (ex.: Inter)
  nosso_numero         VARCHAR(20)     NULL,
  nosso_numero_dv      VARCHAR(2)      NULL,
  -- número do documento impresso no boleto (seu número, 15 posições no CNAB 240)
  seu_numero           VARCHAR(15)     NOT NULL,
  data_emissao         DATE            NOT NULL,
  data_vencimento      DATE            NOT NULL,
  valor                DECIMAL(15,2)   NOT NULL,
  pagador_documento    VARCHAR(14)     NOT NULL,
  pagador_nome         VARCHAR(100)    NOT NULL,
  codigo_barras        CHAR(44)        NULL,
  -- só dígitos (47); a formatação é da tela
  linha_digitavel      CHAR(47)        NULL,
  -- PIX copia e cola do boleto híbrido, quando o banco devolve
  pix_emv              VARCHAR(500)    NULL,
  -- remessa que levou a entrada (canal remessa)
  remessa_id           BIGINT UNSIGNED NULL,
  -- resumo da liquidação, para listar e filtrar; o detalhe fica em ban_ocorrencias
  data_pagamento       DATE            NULL,
  data_credito         DATE            NULL,
  valor_pago           DECIMAL(15,2)   NULL,
  -- última rejeição ou mensagem do banco
  codigo_status        VARCHAR(20)     NULL,
  motivo               VARCHAR(500)    NULL,
  dados                JSON            NOT NULL,
  criado_em            DATETIME        NOT NULL,
  atualizado_em        DATETIME        NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ban_boletos_referencia (empresa_id, referencia),
  UNIQUE KEY uq_ban_boletos_nosso_numero (conta_id, nosso_numero),
  KEY ix_ban_boletos_situacao (empresa_id, situacao, data_vencimento),
  KEY ix_ban_boletos_pagador (empresa_id, pagador_documento),
  KEY ix_ban_boletos_remessa (remessa_id),
  CONSTRAINT fk_ban_boletos_empresa FOREIGN KEY (empresa_id) REFERENCES sys_empresas (id),
  CONSTRAINT fk_ban_boletos_conta FOREIGN KEY (conta_id) REFERENCES ban_contas (id),
  CONSTRAINT fk_ban_boletos_remessa FOREIGN KEY (remessa_id) REFERENCES ban_remessas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Instruções ao banco depois da entrada: baixar (cancelar), alterar
-- vencimento ou valor, conceder/cancelar abatimento, protestar, sustar
-- protesto. Vão na próxima remessa ou direto pela API, conforme o canal.
-- Pedir a mesma instrução com outra igual pendente devolve a pendente.
-- ---------------------------------------------------------------------
CREATE TABLE ban_instrucoes (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id           BIGINT UNSIGNED NOT NULL,
  boleto_id            BIGINT UNSIGNED NOT NULL,
  -- baixar | alterar_vencimento | alterar_valor | conceder_abatimento |
  -- cancelar_abatimento | protestar | sustar_protesto
  tipo                 VARCHAR(30)     NOT NULL,
  -- novo vencimento, valor do abatimento etc.
  dados                JSON            NULL,
  canal                VARCHAR(10)     NOT NULL,
  -- pendente | enviada | confirmada | rejeitada
  situacao             VARCHAR(20)     NOT NULL DEFAULT 'pendente',
  remessa_id           BIGINT UNSIGNED NULL,
  codigo_status        VARCHAR(20)     NULL,
  motivo               VARCHAR(500)    NULL,
  usuario_id           BIGINT UNSIGNED NULL,
  criado_em            DATETIME        NOT NULL,
  atualizado_em        DATETIME        NULL,
  PRIMARY KEY (id),
  KEY ix_ban_instrucoes_boleto (boleto_id, situacao),
  KEY ix_ban_instrucoes_remessa (remessa_id),
  CONSTRAINT fk_ban_instrucoes_empresa FOREIGN KEY (empresa_id) REFERENCES sys_empresas (id),
  CONSTRAINT fk_ban_instrucoes_boleto FOREIGN KEY (boleto_id) REFERENCES ban_boletos (id),
  CONSTRAINT fk_ban_instrucoes_remessa FOREIGN KEY (remessa_id) REFERENCES ban_remessas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Arquivos de retorno CNAB importados. O hash impede importar o mesmo
-- arquivo duas vezes; as linhas de detalhe viram ban_ocorrencias.
-- ---------------------------------------------------------------------
CREATE TABLE ban_retornos (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id           BIGINT UNSIGNED NOT NULL,
  conta_id             INT UNSIGNED    NOT NULL,
  -- NSA do arquivo do banco
  numero               INT             NULL,
  layout               CHAR(3)         NOT NULL,
  nome_arquivo         VARCHAR(120)    NOT NULL,
  data_arquivo         DATE            NULL,
  -- SHA-256 do conteúdo
  hash                 CHAR(64)        NOT NULL,
  qtde_registros       INT             NOT NULL DEFAULT 0,
  conteudo             LONGTEXT        NOT NULL,
  usuario_id           BIGINT UNSIGNED NULL,
  criado_em            DATETIME        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ban_retornos_hash (conta_id, hash),
  KEY ix_ban_retornos_empresa (empresa_id, criado_em),
  CONSTRAINT fk_ban_retornos_empresa FOREIGN KEY (empresa_id) REFERENCES sys_empresas (id),
  CONSTRAINT fk_ban_retornos_conta FOREIGN KEY (conta_id) REFERENCES ban_contas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Extratos importados: arquivo OFX ou consulta de extrato pela API.
-- ---------------------------------------------------------------------
CREATE TABLE ban_extratos (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id           BIGINT UNSIGNED NOT NULL,
  conta_id             INT UNSIGNED    NOT NULL,
  -- ofx | api
  origem               VARCHAR(10)     NOT NULL,
  nome_arquivo         VARCHAR(120)    NULL,
  data_inicial         DATE            NOT NULL,
  data_final           DATE            NOT NULL,
  -- LEDGERBAL do OFX, para conferir com o saldo do ERP
  saldo                DECIMAL(15,2)   NULL,
  data_saldo           DATE            NULL,
  -- SHA-256 do arquivo; nulo na origem api
  hash                 CHAR(64)        NULL,
  qtde_lancamentos     INT             NOT NULL DEFAULT 0,
  conteudo             LONGTEXT        NULL,
  usuario_id           BIGINT UNSIGNED NULL,
  criado_em            DATETIME        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ban_extratos_hash (conta_id, hash),
  KEY ix_ban_extratos_periodo (conta_id, data_inicial),
  CONSTRAINT fk_ban_extratos_empresa FOREIGN KEY (empresa_id) REFERENCES sys_empresas (id),
  CONSTRAINT fk_ban_extratos_conta FOREIGN KEY (conta_id) REFERENCES ban_contas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Lançamentos do extrato. O FITID único por conta faz extratos com
-- períodos sobrepostos não duplicarem lançamento.
-- A conciliação é do módulo financeiro: ele lê os pendentes pela API,
-- casa com os lançamentos dele e devolve a referência do lançamento do ERP.
-- ---------------------------------------------------------------------
CREATE TABLE ban_extrato_lancamentos (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id             BIGINT UNSIGNED NOT NULL,
  conta_id               INT UNSIGNED    NOT NULL,
  extrato_id             BIGINT UNSIGNED NOT NULL,
  -- ponytail: FITID como chave; banco que não manda FITID recebe SHA-256 de
  -- data|valor|documento|histórico, e banco que troca o FITID a cada download duplica
  fitid                  VARCHAR(255)    NOT NULL,
  data_lancamento        DATE            NOT NULL,
  -- negativo = débito
  valor                  DECIMAL(15,2)   NOT NULL,
  -- TRNTYPE do OFX: CREDIT, DEBIT, FEE, XFER, PAYMENT...
  tipo                   VARCHAR(12)     NULL,
  -- CHECKNUM / REFNUM
  documento              VARCHAR(40)     NULL,
  historico              VARCHAR(255)    NULL,
  -- pendente | conciliado | ignorado
  situacao               VARCHAR(12)     NOT NULL DEFAULT 'pendente',
  -- lançamento do ERP que cobre este, informado pelo módulo ("MOV-789")
  referencia_conciliacao VARCHAR(80)     NULL,
  conciliado_em          DATETIME        NULL,
  usuario_id             BIGINT UNSIGNED NULL,
  criado_em              DATETIME        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ban_extrato_lancamentos_fitid (conta_id, fitid),
  KEY ix_ban_extrato_lancamentos_situacao (conta_id, situacao, data_lancamento),
  KEY ix_ban_extrato_lancamentos_extrato (extrato_id),
  CONSTRAINT fk_ban_extrato_lancamentos_empresa FOREIGN KEY (empresa_id) REFERENCES sys_empresas (id),
  CONSTRAINT fk_ban_extrato_lancamentos_conta FOREIGN KEY (conta_id) REFERENCES ban_contas (id),
  CONSTRAINT fk_ban_extrato_lancamentos_extrato FOREIGN KEY (extrato_id) REFERENCES ban_extratos (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Ocorrências: tudo o que o banco disse sobre cada boleto, venha do
-- arquivo de retorno, da consulta pela API ou de webhook do banco.
--
-- É também o canal de volta para os módulos: GET /api/ocorrencias?desde=<id>
-- devolve as novas em ordem; o módulo guarda o último id lido. Sem webhook
-- de saída e sem tabela de fila.
--
-- chave_dedup impede contar a mesma liquidação duas vezes (o arquivo e a
-- API trazendo o mesmo pagamento, ou o mesmo pagamento em dois retornos):
-- SHA-256 de conta|nosso número|tipo|data|valor pago, preenchida em
-- entrada, liquidacao e baixa; nula nos tipos que podem repetir (tarifa).
-- ---------------------------------------------------------------------
CREATE TABLE ban_ocorrencias (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id             BIGINT UNSIGNED NOT NULL,
  conta_id               INT UNSIGNED    NOT NULL,
  -- nulo quando o nosso número não bate com nenhum boleto (aparece na tela para tratar)
  boleto_id              BIGINT UNSIGNED NULL,
  nosso_numero           VARCHAR(20)     NOT NULL,
  -- arquivo | api | webhook
  origem                 VARCHAR(10)     NOT NULL,
  retorno_id             BIGINT UNSIGNED NULL,
  -- entrada | rejeicao | liquidacao | baixa | alteracao | protesto | tarifa | outra
  tipo                   VARCHAR(20)     NOT NULL,
  -- código da ocorrência no layout do banco e a descrição dele (com os motivos de rejeição)
  codigo_banco           VARCHAR(10)     NULL,
  motivo                 VARCHAR(500)    NULL,
  data_ocorrencia        DATE            NOT NULL,
  data_credito           DATE            NULL,
  valor_titulo           DECIMAL(15,2)   NULL,
  valor_pago             DECIMAL(15,2)   NULL,
  -- juros + multa
  valor_juros            DECIMAL(15,2)   NULL,
  valor_desconto         DECIMAL(15,2)   NULL,
  valor_abatimento       DECIMAL(15,2)   NULL,
  valor_tarifa           DECIMAL(15,2)   NULL,
  chave_dedup            CHAR(64)        NULL,
  -- crédito do extrato que cobriu esta liquidação (o banco costuma creditar
  -- a cobrança do dia num lançamento só; várias ocorrências apontam para ele)
  extrato_lancamento_id  BIGINT UNSIGNED NULL,
  criado_em              DATETIME        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ban_ocorrencias_dedup (conta_id, chave_dedup),
  KEY ix_ban_ocorrencias_boleto (boleto_id),
  KEY ix_ban_ocorrencias_feed (empresa_id, id),
  KEY ix_ban_ocorrencias_credito (conta_id, data_credito),
  CONSTRAINT fk_ban_ocorrencias_empresa FOREIGN KEY (empresa_id) REFERENCES sys_empresas (id),
  CONSTRAINT fk_ban_ocorrencias_conta FOREIGN KEY (conta_id) REFERENCES ban_contas (id),
  CONSTRAINT fk_ban_ocorrencias_boleto FOREIGN KEY (boleto_id) REFERENCES ban_boletos (id),
  CONSTRAINT fk_ban_ocorrencias_retorno FOREIGN KEY (retorno_id) REFERENCES ban_retornos (id),
  CONSTRAINT fk_ban_ocorrencias_extrato FOREIGN KEY (extrato_lancamento_id) REFERENCES ban_extrato_lancamentos (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Chaves de API dos módulos (a fase 3 do plano do BMNFe, já de saída):
-- credencial sem prazo, revogável. A chave aparece uma vez, na criação;
-- o banco guarda só o SHA-256 dela. Header: Authorization: Bearer <chave>.
-- ---------------------------------------------------------------------
CREATE TABLE ban_chaves_api (
  id                   INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  empresa_id           BIGINT UNSIGNED NOT NULL,
  -- módulo que usa a chave: "Financeiro", "PDV", "Contratos"...
  nome                 VARCHAR(60)     NOT NULL,
  -- primeiros caracteres da chave, para reconhecer na lista
  prefixo              CHAR(8)         NOT NULL,
  chave_hash           CHAR(64)        NOT NULL,
  ativo                TINYINT(1)      NOT NULL DEFAULT 1,
  ultimo_uso           DATETIME        NULL,
  criado_em            DATETIME        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ban_chaves_api_hash (chave_hash),
  CONSTRAINT fk_ban_chaves_api_empresa FOREIGN KEY (empresa_id) REFERENCES sys_empresas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Log de comunicação com as APIs dos bancos (como o nfe_log). Token,
-- client_secret e certificado são mascarados antes de gravar.
-- ---------------------------------------------------------------------
CREATE TABLE ban_log (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id           BIGINT UNSIGNED NOT NULL,
  conta_id             INT UNSIGNED    NULL,
  operacao             VARCHAR(40)     NOT NULL,
  url                  VARCHAR(255)    NULL,
  referencia           VARCHAR(80)     NULL,
  sucesso              TINYINT(1)      NOT NULL DEFAULT 0,
  -- status HTTP ou código do banco
  codigo_status        VARCHAR(20)     NULL,
  motivo               VARCHAR(255)    NULL,
  duracao_ms           INT             NULL,
  envio                LONGTEXT        NULL,
  retorno              LONGTEXT        NULL,
  criado_em            DATETIME        NOT NULL,
  PRIMARY KEY (id),
  KEY ix_ban_log_empresa (empresa_id, criado_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

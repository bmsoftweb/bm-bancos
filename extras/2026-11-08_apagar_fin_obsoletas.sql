-- =====================================================================
-- Apaga as tabelas de boleto/CNAB/conciliação do ERP que o BMBancos
-- substitui (ban_boletos, ban_remessas, ban_retornos, ban_extrato_lancamentos).
-- Estavam vazias e nenhum projeto em D:\projetos as usava em 08/11/2026.
--
-- Rode depois de conferir que continuam vazias:
-- =====================================================================
SELECT 'fin_boletos' t, COUNT(*) n FROM fin_boletos
UNION ALL SELECT 'fin_cnab_remessa', COUNT(*) FROM fin_cnab_remessa
UNION ALL SELECT 'fin_cnab_retorno', COUNT(*) FROM fin_cnab_retorno
UNION ALL SELECT 'fin_conciliacao_bancaria', COUNT(*) FROM fin_conciliacao_bancaria;

DROP TABLE fin_cnab_retorno, fin_cnab_remessa, fin_boletos, fin_conciliacao_bancaria;

-- =====================================================================
-- Reversão (estrutura como estava)
-- =====================================================================
-- CREATE TABLE `fin_boletos` (
--   `id` bigint unsigned NOT NULL AUTO_INCREMENT,
--   `conta_receber_id` bigint unsigned NOT NULL,
--   `nosso_numero` varchar(30) DEFAULT NULL,
--   `codigo_barras` varchar(60) DEFAULT NULL,
--   `linha_digitavel` varchar(60) DEFAULT NULL,
--   `data_emissao` date DEFAULT NULL,
--   `data_vencimento` date NOT NULL,
--   `status` enum('EMITIDO','PAGO','VENCIDO','CANCELADO') NOT NULL DEFAULT 'EMITIDO',
--   PRIMARY KEY (`id`),
--   KEY `conta_receber_id` (`conta_receber_id`),
--   CONSTRAINT `fin_boletos_ibfk_1` FOREIGN KEY (`conta_receber_id`) REFERENCES `fin_contas_receber` (`id`)
-- ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--
-- CREATE TABLE `fin_cnab_remessa` (
--   `id` bigint unsigned NOT NULL AUTO_INCREMENT,
--   `conta_bancaria_id` bigint unsigned NOT NULL,
--   `banco_codigo` varchar(5) DEFAULT NULL,
--   `data_geracao` datetime DEFAULT CURRENT_TIMESTAMP,
--   `arquivo_path` varchar(500) DEFAULT NULL,
--   `quantidade_titulos` int DEFAULT NULL,
--   `status` enum('GERADA','ENVIADA','PROCESSADA') NOT NULL DEFAULT 'GERADA',
--   PRIMARY KEY (`id`),
--   KEY `conta_bancaria_id` (`conta_bancaria_id`),
--   CONSTRAINT `fin_cnab_remessa_ibfk_1` FOREIGN KEY (`conta_bancaria_id`) REFERENCES `fin_contas_bancarias` (`id`)
-- ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--
-- CREATE TABLE `fin_cnab_retorno` (
--   `id` bigint unsigned NOT NULL AUTO_INCREMENT,
--   `remessa_id` bigint unsigned DEFAULT NULL,
--   `data_processamento` datetime DEFAULT CURRENT_TIMESTAMP,
--   `arquivo_path` varchar(500) DEFAULT NULL,
--   `quantidade_processados` int DEFAULT NULL,
--   PRIMARY KEY (`id`),
--   KEY `remessa_id` (`remessa_id`),
--   CONSTRAINT `fin_cnab_retorno_ibfk_1` FOREIGN KEY (`remessa_id`) REFERENCES `fin_cnab_remessa` (`id`)
-- ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--
-- CREATE TABLE `fin_conciliacao_bancaria` (
--   `id` bigint unsigned NOT NULL AUTO_INCREMENT,
--   `conta_bancaria_id` bigint unsigned NOT NULL,
--   `data_extrato` date NOT NULL,
--   `valor_extrato` decimal(15,2) NOT NULL,
--   `movimento_id` bigint unsigned DEFAULT NULL,
--   `status` enum('CONCILIADO','PENDENTE','DIVERGENTE') NOT NULL DEFAULT 'PENDENTE',
--   PRIMARY KEY (`id`),
--   KEY `conta_bancaria_id` (`conta_bancaria_id`),
--   KEY `movimento_id` (`movimento_id`),
--   CONSTRAINT `fin_conciliacao_bancaria_ibfk_1` FOREIGN KEY (`conta_bancaria_id`) REFERENCES `fin_contas_bancarias` (`id`),
--   CONSTRAINT `fin_conciliacao_bancaria_ibfk_2` FOREIGN KEY (`movimento_id`) REFERENCES `fin_movimentos_caixa` (`id`)
-- ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

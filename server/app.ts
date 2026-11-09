import 'dotenv/config';
import express, { Request, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { pool, checkDbHealth, CONFIG_FALTANDO, MENSAGEM_CONFIG_FALTANDO } from './db.js';
import { criarRotas } from './rotas/bancos.js';
import { criarToken, exigirSessao } from './auth.js';

/** Aceita bcrypt e os formatos legados que ainda aparecem em bases antigas */
function senhaConfere(informada: string, gravada: string): boolean {
  if (!gravada?.trim()) return false;

  if (/^\$2[aby]\$/.test(gravada)) {
    try {
      if (bcrypt.compareSync(informada, gravada)) return true;
    } catch {
      // segue para os demais formatos
    }
  }

  if (informada === gravada) return true;

  for (const algoritmo of ['md5', 'sha256', 'sha1']) {
    const hash = crypto.createHash(algoritmo).update(informada).digest('hex');
    if (hash.toLowerCase() === gravada.toLowerCase()) return true;
  }

  return false;
}

const COLUNAS_EMPRESA = 'id, cnpj, razao_social, nome_fantasia, logradouro, numero, complemento, bairro, cidade, uf, cep, telefone, email, ativo';

/**
 * Monta o app Express com todas as rotas /api, sem listen e sem Vite:
 *   local    -> server.ts acrescenta o Vite e dá listen numa porta
 *   produção -> api/index.ts exporta este app como função serverless da Vercel
 */
export function createApp() {
  const app = express();
  // Certificado .pfx e arquivos de retorno/OFX em base64 passam do limite padrão de 100kb
  app.use(express.json({ limit: '25mb' }));

  // Sem as variáveis de conexão nenhuma rota tem como funcionar: melhor dizer o
  // que falta do que deixar o mysql2 tentar 127.0.0.1 e devolver ECONNREFUSED.
  if (CONFIG_FALTANDO.length) {
    app.use('/api', (req: Request, res: Response, proximo) => {
      if (req.path === '/db/status') return proximo();
      res.status(503).json({ success: false, error: MENSAGEM_CONFIG_FALTANDO });
    });
  }

  // =========================================================================
  // Autenticação: CNPJ da empresa + usuário + senha (usuários do ERP)
  // =========================================================================
  app.post('/api/login', async (req: Request, res: Response) => {
    try {
      const { cnpj, usuario, senha } = req.body || {};
      const login = String(usuario || '').trim().toLowerCase();
      const cnpjLimpo = String(cnpj || '').replace(/\D/g, '');

      if (cnpjLimpo.length !== 14 || !login) {
        return res.status(400).json({ success: false, error: 'Informe o CNPJ da empresa e o usuário.' });
      }

      const [empresas] = await pool.query<any[]>(`SELECT ${COLUNAS_EMPRESA} FROM sys_empresas WHERE cnpj = ? LIMIT 1`, [cnpjLimpo]);
      if (!empresas.length) {
        return res.status(401).json({ success: false, error: 'Nenhuma empresa cadastrada no ERP com este CNPJ.' });
      }
      const empresa = empresas[0];
      if (!empresa.ativo) return res.status(401).json({ success: false, error: 'Esta empresa está inativa.' });

      const [usuarios] = await pool.query<any[]>(
        `SELECT id, login AS nome, login AS email, senha_hash FROM sys_usuarios
          WHERE empresa_id = ? AND LOWER(TRIM(login)) = ? AND ativo = 1 LIMIT 1`,
        [empresa.id, login],
      );
      if (!usuarios.length) {
        return res.status(401).json({ success: false, error: `Usuário "${login}" não localizado nesta empresa.` });
      }

      const encontrado = usuarios[0];
      const informada = String(senha || '');
      const semSenhaCadastrada = !String(encontrado.senha_hash || '').trim();

      if (semSenhaCadastrada) {
        // Usuário criado direto no banco, sem senha: a primeira que ele digitar
        // passa a ser a dele. Em branco não vale, senão o acesso ficaria aberto.
        if (!informada) {
          return res.status(401).json({
            success: false,
            error: 'Este usuário ainda não tem senha. Digite a senha que passará a valer para ele.',
          });
        }
      } else if (!senhaConfere(informada, encontrado.senha_hash)) {
        return res.status(401).json({ success: false, error: 'Senha incorreta.' });
      }

      // Senha ausente ou em formato legado vira bcrypt neste acesso
      if (semSenhaCadastrada || !/^\$2[aby]\$/.test(encontrado.senha_hash)) {
        await pool.query('UPDATE sys_usuarios SET senha_hash = ? WHERE id = ?', [bcrypt.hashSync(informada, 10), encontrado.id]);
      }

      delete encontrado.senha_hash;
      encontrado.empresa_id = empresa.id;
      // O token é a credencial das próximas chamadas: é dele que sai a empresa
      const token = criarToken(Number(encontrado.id), Number(empresa.id));
      res.json({ success: true, token, usuario: encontrado, empresa });
    } catch (err: any) {
      const semTabela = err?.code === 'ER_NO_SUCH_TABLE';
      res.status(semTabela ? 503 : 500).json({
        success: false,
        error: semTabela ? 'Faltam as tabelas do ERP (sys_empresas / sys_usuarios) neste banco.' : err.message,
      });
    }
  });

  // =========================================================================
  // Daqui para baixo tudo exige sessão ou chave de API: só o login acima é público
  // =========================================================================
  app.use('/api', exigirSessao);

  app.get('/api/db/status', async (_req, res) => {
    res.json(await checkDbHealth());
  });

  app.get('/api/painel', async (req: Request, res: Response) => {
    try {
      const empresaId = req.usuario!.empresaId;
      const [[contagens]] = await pool.query<any[]>(
        `SELECT COUNT(*) AS boletos,
                COALESCE(SUM(situacao IN ('emitido', 'enviado', 'processando')), 0) AS aguardando,
                COALESCE(SUM(situacao = 'registrado'), 0) AS registrados,
                COALESCE(SUM(situacao = 'registrado' AND data_vencimento < CURDATE()), 0) AS vencidos,
                COALESCE(SUM(situacao = 'rejeitado'), 0) AS rejeitados,
                COALESCE(SUM(IF(situacao = 'registrado', valor, 0)), 0) AS valor_aberto,
                COALESCE(SUM(IF(situacao = 'liquidado' AND data_pagamento >= DATE_FORMAT(CURDATE(), '%Y-%m-01'), valor_pago, 0)), 0) AS recebido_mes
           FROM ban_boletos WHERE empresa_id = ?`,
        [empresaId],
      );
      const [[pendencias]] = await pool.query<any[]>(
        `SELECT (SELECT COUNT(*) FROM ban_boletos WHERE empresa_id = ? AND canal = 'remessa' AND situacao = 'emitido') AS boletos_remessa,
                (SELECT COUNT(*) FROM ban_instrucoes WHERE empresa_id = ? AND canal = 'remessa' AND situacao = 'pendente') AS instrucoes_remessa,
                (SELECT COUNT(*) FROM ban_ocorrencias WHERE empresa_id = ? AND boleto_id IS NULL) AS ocorrencias_sem_boleto,
                (SELECT COUNT(*) FROM ban_extrato_lancamentos WHERE empresa_id = ? AND situacao = 'pendente') AS lancamentos_pendentes`,
        [empresaId, empresaId, empresaId, empresaId],
      );
      const [ocorrencias] = await pool.query<any[]>(
        `SELECT o.id, o.tipo, o.data_ocorrencia, o.valor_pago, o.nosso_numero, o.motivo, b.pagador_nome, b.referencia
           FROM ban_ocorrencias o LEFT JOIN ban_boletos b ON b.id = o.boleto_id
          WHERE o.empresa_id = ? ORDER BY o.id DESC LIMIT 8`,
        [empresaId],
      );
      const [erros] = await pool.query<any[]>(
        'SELECT operacao, codigo_status, motivo, criado_em FROM ban_log WHERE empresa_id = ? AND sucesso = 0 ORDER BY id DESC LIMIT 5',
        [empresaId],
      );
      const [certificados] = await pool.query<any[]>(
        `SELECT c.descricao, k.certificado_validade FROM ban_credenciais k JOIN ban_contas c ON c.id = k.conta_id
          WHERE c.empresa_id = ? AND c.ativo = 1 AND k.certificado_validade IS NOT NULL ORDER BY k.certificado_validade`,
        [empresaId],
      );
      res.json({ contagens, pendencias, ocorrencias, erros, certificados });
    } catch (err: any) {
      const semTabela = err?.code === 'ER_NO_SUCH_TABLE';
      res.status(semTabela ? 503 : 500).json({ error: semTabela ? 'Faltam as tabelas do BMBancos: rode o extras/bmbancos_schema.sql no banco.' : err.message });
    }
  });

  app.use('/api', criarRotas());

  return app;
}

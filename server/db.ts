import mysql from 'mysql2/promise';

const dbConfig: mysql.PoolOptions = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: Number(process.env.MYSQL_PORT) || 3306,
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'bmerp',
  waitForConnections: true,
  connectionLimit: 10,
  connectTimeout: 20000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  dateStrings: true,
};

export const pool = mysql.createPool(dbConfig);

/**
 * Variáveis de conexão que não foram definidas.
 *
 * Sem elas o mysql2 cai nos padrões e tenta 127.0.0.1 — que em deploy
 * serverless é o próprio contêiner, e o erro que chega na tela é um
 * ECONNREFUSED sem pista nenhuma da causa real.
 */
export const CONFIG_FALTANDO = ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_DATABASE', 'SESSION_SECRET'].filter(
  (nome) => !process.env[nome],
);

export const MENSAGEM_CONFIG_FALTANDO =
  `Configuração do servidor incompleta: falta definir ${CONFIG_FALTANDO.join(', ')}. ` +
  'Em execução local isso vem do arquivo .env; na Vercel, de Settings › Environment ' +
  'Variables (e o deploy precisa ser refeito depois de definí-las).';

/** Tabelas do extras/bmbancos_schema.sql (e as de usuários do ERP) */
export const DB_TABLES = [
  'sys_usuarios',
  'sys_empresas',
  'ban_contas',
  'ban_credenciais',
  'ban_boletos',
  'ban_instrucoes',
  'ban_remessas',
  'ban_retornos',
  'ban_ocorrencias',
  'ban_extratos',
  'ban_extrato_lancamentos',
  'ban_chaves_api',
  'ban_log',
];

export async function checkDbHealth() {
  const inicio = Date.now();

  if (CONFIG_FALTANDO.length) {
    return {
      connected: false,
      latencyMs: 0,
      error: MENSAGEM_CONFIG_FALTANDO,
      code: 'CONFIG_AUSENTE',
      host: dbConfig.host,
      port: dbConfig.port,
      user: dbConfig.user,
      database: dbConfig.database,
      tableCounts: {},
      tabelasFaltando: DB_TABLES,
    };
  }

  try {
    const conn = await pool.getConnection();
    const [verRows] = await conn.query<any[]>('SELECT VERSION() as version, DATABASE() as db');
    const latencyMs = Date.now() - inicio;

    const tableCounts: Record<string, number> = {};
    const faltando: string[] = [];
    for (const t of DB_TABLES) {
      try {
        const [res] = await conn.query<any[]>(`SELECT COUNT(*) as cnt FROM ${t}`);
        tableCounts[t] = res[0]?.cnt ?? 0;
      } catch {
        // A tabela não existe: o schema ainda não foi aplicado
        faltando.push(t);
      }
    }

    conn.release();

    return {
      connected: true,
      latencyMs,
      version: verRows[0]?.version || '',
      database: verRows[0]?.db || dbConfig.database,
      host: dbConfig.host,
      port: dbConfig.port,
      user: dbConfig.user,
      tableCounts,
      tabelasFaltando: faltando,
    };
  } catch (err: any) {
    return {
      connected: false,
      latencyMs: Date.now() - inicio,
      error: err.message || 'Falha de conexão com o MySQL',
      code: err.code || 'UNKNOWN',
      host: dbConfig.host,
      port: dbConfig.port,
      user: dbConfig.user,
      database: dbConfig.database,
      tableCounts: {},
      tabelasFaltando: DB_TABLES,
    };
  }
}

/**
 * Cliente HTTP das APIs dos bancos: TLS mútuo com o certificado da conta,
 * token OAuth em cache e uma linha em ban_log por chamada (segredos mascarados).
 */
import https from 'https';
import { pool } from '../db.js';
import { dataHoraMysql } from './datas.js';
import { ClienteApi, Credenciais, RespostaHttp } from './tipos.js';

const TEMPO_LIMITE_MS = 40_000;

/**
 * Falha de rede ou tempo esgotado: o pedido pode ter chegado ao banco ou não.
 * Quem registra boleto trata diferente de uma recusa (consulta antes de reenviar).
 */
export class FalhaComunicacao extends Error {}

/** Tokens por conta + URL + escopo, até 1 minuto antes de vencer */
const tokens = new Map<string, { token: string; ate: number }>();

export function esquecerTokens(contaId: number) {
  for (const k of tokens.keys()) if (k.startsWith(`${contaId}|`)) tokens.delete(k);
}

/** Mascara tokens, segredos e certificados antes de gravar no log */
export function mascarar(texto: string): string {
  return texto
    .replace(/(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g, '$1 ***')
    .replace(/("?(?:access_token|client_secret|refresh_token|password|senha)"?\s*[:=]\s*"?)[^"&,\s}]+/gi, '$1***')
    .replace(/((?:client_secret|access_token)=)[^&\s]+/gi, '$1***');
}

export interface OpcoesCliente {
  empresaId: number;
  contaId: number;
  credenciais: Credenciais;
  /** Certificado e chave em PEM (do .pfx da conta); sem eles a chamada vai sem TLS mútuo */
  certificadoPem?: string;
  chavePem?: string;
  /** Referência do boleto, só para o log */
  referencia?: string | null;
}

async function gravarLog(o: OpcoesCliente, operacao: string, url: string, sucesso: boolean, status: string, motivo: string, inicio: number, envio: string, retorno: string) {
  try {
    await pool.query(
      `INSERT INTO ban_log (empresa_id, conta_id, operacao, url, referencia, sucesso, codigo_status, motivo, duracao_ms, envio, retorno, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        o.empresaId, o.contaId, operacao.slice(0, 40), url.slice(0, 255), o.referencia || null, sucesso ? 1 : 0,
        status.slice(0, 20), motivo.slice(0, 255), Date.now() - inicio, mascarar(envio), mascarar(retorno), dataHoraMysql(),
      ],
    );
  } catch (err: any) {
    // O log nunca derruba a operação com o banco
    console.error('ban_log:', err?.message);
  }
}

/** Mensagem curta para o log a partir do corpo de erro do banco */
function resumo(corpo: any, texto: string): string {
  if (corpo && typeof corpo === 'object') {
    const e = corpo.erros?.[0] || corpo.errors?.[0] || corpo.mensagens?.[0] || corpo;
    return String(e.mensagem || e.message || e.textoMensagem || e.error_description || e.error || '').trim() || texto.slice(0, 200);
  }
  return texto.slice(0, 200);
}

export function criarClienteApi(o: OpcoesCliente): ClienteApi {
  const agente = new https.Agent({
    keepAlive: true,
    ...(o.certificadoPem && o.chavePem ? { cert: o.certificadoPem, key: o.chavePem } : {}),
  });

  function enviar(metodo: string, url: string, corpo: string | undefined, cabecalhos: Record<string, string>): Promise<RespostaHttp> {
    return new Promise((resolve, reject) => {
      const req = https.request(
        url,
        {
          method: metodo,
          agent: agente,
          headers: { Accept: 'application/json', ...cabecalhos, ...(corpo !== undefined ? { 'Content-Length': Buffer.byteLength(corpo) } : {}) },
          timeout: TEMPO_LIMITE_MS,
        },
        (res) => {
          const partes: Buffer[] = [];
          res.on('data', (p) => partes.push(p));
          res.on('end', () => {
            const texto = Buffer.concat(partes).toString('utf8');
            let json: any = texto;
            try {
              json = texto ? JSON.parse(texto) : null;
            } catch {
              // não era JSON
            }
            resolve({ status: res.statusCode || 0, corpo: json, texto });
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error(`O banco não respondeu em ${TEMPO_LIMITE_MS / 1000} s.`)));
      req.on('error', reject);
      if (corpo !== undefined) req.write(corpo);
      req.end();
    });
  }

  /** Envia, grava o log e devolve; falha de rede também vai para o log antes de subir */
  async function comLog(operacao: string, metodo: string, url: string, corpo: string | undefined, cabecalhos: Record<string, string>) {
    const inicio = Date.now();
    const envio = `${metodo} ${url}\n${Object.entries(cabecalhos).map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${corpo ?? ''}`;
    let r: RespostaHttp;
    try {
      r = await enviar(metodo, url, corpo, cabecalhos);
    } catch (err: any) {
      await gravarLog(o, operacao, url, false, err?.code || 'REDE', err?.message || 'Falha de rede', inicio, envio, '');
      throw new FalhaComunicacao(`Falha de comunicação com o banco (${operacao}): ${err?.message || err}`);
    }
    const ok = r.status >= 200 && r.status < 300;
    await gravarLog(o, operacao, url, ok, String(r.status), ok ? 'OK' : resumo(r.corpo, r.texto), inicio, envio, r.texto);
    // 5xx: não dá para saber se o banco processou; quem chama consulta antes de reenviar
    if (r.status >= 500) throw new FalhaComunicacao(`O banco respondeu ${r.status} (${operacao}): ${resumo(r.corpo, r.texto) || 'sem detalhe'}`);
    return r;
  }

  return {
    credenciais: o.credenciais,

    async oauth({ url, escopo, autenticacao, extras }) {
      const k = `${o.contaId}|${url}|${escopo || ''}`;
      const guardado = tokens.get(k);
      if (guardado && guardado.ate > Date.now()) return guardado.token;

      const form = new URLSearchParams({ grant_type: 'client_credentials', ...(escopo ? { scope: escopo } : {}), ...extras });
      const cab: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
      if (autenticacao === 'basic') {
        cab.Authorization = `Basic ${Buffer.from(`${o.credenciais.clientId}:${o.credenciais.clientSecret}`).toString('base64')}`;
      } else {
        form.set('client_id', o.credenciais.clientId);
        if (o.credenciais.clientSecret) form.set('client_secret', o.credenciais.clientSecret);
      }

      const r = await comLog('token', 'POST', url, form.toString(), cab);
      const token = r.corpo?.access_token;
      if (r.status < 200 || r.status >= 300 || !token) {
        throw new Error(`O banco recusou as credenciais (${r.status}): ${resumo(r.corpo, r.texto) || 'sem detalhe'}`);
      }
      const segundos = Number(r.corpo.expires_in) || 600;
      tokens.set(k, { token, ate: Date.now() + Math.max(30, segundos - 60) * 1000 });
      return token;
    },

    pedir({ metodo, url, corpo, cabecalhos = {}, operacao }) {
      const texto = corpo === undefined ? undefined : JSON.stringify(corpo);
      const cab = texto !== undefined ? { 'Content-Type': 'application/json', ...cabecalhos } : cabecalhos;
      return comLog(operacao, metodo, url, texto, cab);
    },
  };
}

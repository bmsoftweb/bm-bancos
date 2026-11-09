/**
 * Datas no horário de Brasília (UTC-03:00). Nada aqui usa toISOString(), que
 * converteria para UTC e jogaria a data para o dia seguinte depois das 21h.
 */

/** Deslocamento fixo de Brasília. Não há mais horário de verão desde 2019. */
const MS_BRASILIA = -3 * 60 * 60 * 1000;

/** "Agora" em Brasília, como um Date cujos campos locais (getFullYear etc.) já são os de lá */
export function agora(): Date {
  const d = new Date();
  return new Date(d.getTime() + d.getTimezoneOffset() * 60 * 1000 + MS_BRASILIA);
}

function p2(n: number) {
  return String(n).padStart(2, '0');
}

/**
 * Data informada no documento -> Date com os campos locais em horário de Brasília.
 *
 * `new Date("2026-09-20")` é meia-noite em UTC: num servidor no fuso de São Paulo
 * vira 21h do dia anterior (e no dia 1º cai no mês anterior, errando o AAMM da
 * chave); num servidor em UTC fica meia-noite. Aqui:
 *   - vazio                   -> agora
 *   - "2026-09-20"            -> esse dia, na hora atual de Brasília
 *   - "2026-09-20T14:30[:05]" -> essa hora, já em Brasília
 *   - com fuso ("...-03:00", "...Z") -> o instante, convertido para Brasília
 */
export function dataDoDocumento(texto?: string | null): Date {
  if (!texto) return agora();

  const soData = String(texto).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (soData) {
    const hora = agora();
    return new Date(
      Number(soData[1]), Number(soData[2]) - 1, Number(soData[3]),
      hora.getHours(), hora.getMinutes(), hora.getSeconds(),
    );
  }

  const semFuso = String(texto).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (semFuso) {
    return new Date(
      Number(semFuso[1]), Number(semFuso[2]) - 1, Number(semFuso[3]),
      Number(semFuso[4]), Number(semFuso[5]), Number(semFuso[6] || 0),
    );
  }

  const instante = new Date(texto);
  if (Number.isNaN(instante.getTime())) throw new Error(`Data inválida: "${texto}".`);
  return new Date(instante.getTime() + instante.getTimezoneOffset() * 60 * 1000 + MS_BRASILIA);
}

/** "2026-09-20" */
export function dataISO(d: Date = agora()): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

/** "2026-09-20 14:32:05" — formato aceito pelo MySQL */
export function dataHoraMysql(d: Date = agora()): string {
  return `${dataISO(d)} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

/** "20/09/2026 14:32:05" para exibição e para o DANFE */
export function paraBR(valor: string | Date | null | undefined, comHora = true): string {
  if (!valor) return '';
  let d: Date;
  if (valor instanceof Date) {
    d = valor;
  } else {
    // Aceita "2026-09-20 14:32:05", "2026-09-20T14:32:05-03:00" e "2026-09-20"
    const m = String(valor).match(/^(\d{4})-(\d{2})-(\d{2})[T ]?(\d{2})?:?(\d{2})?:?(\d{2})?/);
    if (!m) return String(valor);
    d = new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4] || 0),
      Number(m[5] || 0),
      Number(m[6] || 0),
    );
  }
  const data = `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;
  return comHora ? `${data} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}` : data;
}

/** "AAAA-MM-DD" + n dias (n pode ser negativo) */
export function somarDias(iso: string, n: number): string {
  const [a, m, d] = iso.split('-').map(Number);
  const r = new Date(Date.UTC(a, m - 1, d + n));
  return `${r.getUTCFullYear()}-${p2(r.getUTCMonth() + 1)}-${p2(r.getUTCDate())}`;
}

import React from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, FileText, Landmark, ShieldAlert, ShieldCheck, TrendingUp, XCircle } from 'lucide-react';
import { Painel, StatusBanco } from '../types';
import { Secao, Vazio } from './ui';
import { etiqueta } from './comum';
import { TIPOS_OCORRENCIA, formatarData, formatarDataHora, formatarMoeda, moedaOuTraco } from '../utils/formatters';

const Indicador: React.FC<{
  rotulo: string;
  valor: string | number;
  icone: React.ReactNode;
  cor: string;
  onClick?: () => void;
}> = ({ rotulo, valor, icone, cor, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={!onClick}
    className="text-left bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-4
      flex items-center gap-3 enabled:hover:border-blue-300 dark:enabled:hover:border-blue-800 transition-colors
      enabled:cursor-pointer disabled:cursor-default"
  >
    <div className={`p-2.5 rounded-xl ${cor}`}>{icone}</div>
    <div className="min-w-0">
      <div className="text-lg font-bold text-stone-800 dark:text-stone-100 leading-tight">{valor}</div>
      <div className="text-[11px] text-stone-500 dark:text-stone-400">{rotulo}</div>
    </div>
  </button>
);

/** Dias até a data (negativo = já passou) */
const diasAte = (iso: string) => Math.floor((new Date(String(iso).slice(0, 10) + 'T12:00:00').getTime() - Date.now()) / 86_400_000);

export const Dashboard: React.FC<{
  painel: Painel | null;
  statusBanco: StatusBanco | null;
  onNavegar: (aba: string) => void;
}> = ({ painel, statusBanco, onNavegar }) => {
  if (statusBanco && statusBanco.tabelasFaltando.length > 0) {
    return (
      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-900 dark:text-amber-200">
            <p className="font-bold mb-1">O banco ainda não tem as tabelas do BMBancos.</p>
            <p>
              Rode <code className="font-mono bg-amber-100 dark:bg-amber-900/60 px-1 rounded">extras/bmbancos_schema.sql</code> no banco{' '}
              <strong>{statusBanco.database}</strong>. Faltam: {statusBanco.tabelasFaltando.join(', ')}.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!painel) return <div className="py-16 text-center text-xs text-stone-500">Carregando os indicadores…</div>;

  const c: Partial<Painel['contagens']> = painel.contagens || {};
  const p: Partial<Painel['pendencias']> = painel.pendencias || {};
  const pendencias = [
    { qtd: Number(p.boletos_remessa || 0) + Number(p.instrucoes_remessa || 0), texto: 'boleto(s) e instrução(ões) esperando remessa', aba: 'remessas' },
    { qtd: Number(p.ocorrencias_sem_boleto || 0), texto: 'ocorrência(s) do banco sem boleto correspondente', aba: 'ocorrencias' },
    { qtd: Number(p.lancamentos_pendentes || 0), texto: 'lançamento(s) de extrato para conciliar', aba: 'extratos' },
  ].filter((x) => x.qtd > 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 gap-3">
        <Indicador rotulo="Boletos" valor={c.boletos ?? 0} icone={<FileText className="w-5 h-5 text-blue-600" />} cor="bg-blue-50 dark:bg-blue-950/40" onClick={() => onNavegar('boletos')} />
        <Indicador rotulo="Aguardando o banco" valor={c.aguardando ?? 0} icone={<Clock className="w-5 h-5 text-amber-600" />} cor="bg-amber-50 dark:bg-amber-950/40" onClick={() => onNavegar('boletos')} />
        <Indicador rotulo="Registrados (em aberto)" valor={c.registrados ?? 0} icone={<CheckCircle2 className="w-5 h-5 text-violet-600" />} cor="bg-violet-50 dark:bg-violet-950/40" onClick={() => onNavegar('boletos')} />
        <Indicador rotulo="Vencidos sem pagamento" valor={c.vencidos ?? 0} icone={<CalendarClock className="w-5 h-5 text-red-600" />} cor="bg-red-50 dark:bg-red-950/40" onClick={() => onNavegar('boletos')} />
        <Indicador rotulo="Valor em aberto" valor={formatarMoeda(c.valor_aberto)} icone={<Landmark className="w-5 h-5 text-stone-600 dark:text-stone-300" />} cor="bg-stone-100 dark:bg-stone-800" />
        <Indicador rotulo="Recebido no mês" valor={formatarMoeda(c.recebido_mes)} icone={<TrendingUp className="w-5 h-5 text-emerald-600" />} cor="bg-emerald-50 dark:bg-emerald-950/40" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 flex flex-col gap-4">
          {pendencias.length > 0 && (
            <Secao titulo="Pendências" variante="cartao">
              <ul className="flex flex-col gap-2 text-xs">
                {pendencias.map((x) => (
                  <li key={x.aba}>
                    <button type="button" onClick={() => onNavegar(x.aba)} className="flex items-center gap-2 text-left hover:text-blue-600 cursor-pointer">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      <span><strong>{x.qtd}</strong> {x.texto}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Secao>
          )}

          <Secao titulo="Últimas ocorrências do banco" variante="cartao">
            {painel.ocorrencias.length === 0 ? (
              <Vazio mensagem="Nenhuma ocorrência recebida ainda." />
            ) : (
              <table className="w-full text-xs">
                <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                  {painel.ocorrencias.map((o) => (
                    <tr key={o.id}>
                      <td className="py-2 pr-3 text-center whitespace-nowrap w-24">{formatarData(o.data_ocorrencia)}</td>
                      <td className="py-2 pr-3 text-center w-24">{etiqueta(TIPOS_OCORRENCIA, o.tipo)}</td>
                      <td className="py-2 pr-3 truncate max-w-[220px]" title={o.motivo || undefined}>{o.pagador_nome || `Nosso número ${o.nosso_numero}`}</td>
                      <td className="py-2 pr-3">{o.referencia || ''}</td>
                      <td className="py-2 text-right">{moedaOuTraco(o.valor_pago)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Secao>
        </div>

        <div className="flex flex-col gap-4">
          <Secao titulo="Certificados das APIs" variante="cartao">
            {painel.certificados.length === 0 ? (
              <Vazio mensagem="Nenhuma conta com certificado." />
            ) : (
              <ul className="flex flex-col gap-2 text-xs">
                {painel.certificados.map((k) => {
                  const dias = diasAte(k.certificado_validade);
                  const Icone = dias < 0 ? ShieldAlert : ShieldCheck;
                  return (
                    <li key={k.descricao} className="flex items-start gap-2">
                      <Icone className={`w-4 h-4 shrink-0 ${dias < 0 ? 'text-red-500' : dias <= 30 ? 'text-amber-500' : 'text-emerald-500'}`} />
                      <div>
                        <div className="font-semibold text-stone-800 dark:text-stone-100">{k.descricao}</div>
                        <div className="text-stone-500 dark:text-stone-400">
                          {dias < 0 ? 'Vencido em' : `Vence em ${dias} dia(s) —`} {formatarData(k.certificado_validade)}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Secao>

          <Secao titulo="Últimas falhas" variante="cartao">
            {painel.erros.length === 0 ? (
              <Vazio mensagem="Nenhuma falha registrada." />
            ) : (
              <ul className="flex flex-col gap-2 text-xs">
                {painel.erros.map((e, i) => (
                  <li key={i} className="flex gap-2">
                    <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="font-semibold text-stone-700 dark:text-stone-200">{e.operacao}</div>
                      <div className="text-stone-500 dark:text-stone-400 break-words">
                        {e.codigo_status ? `${e.codigo_status} — ` : ''}{e.motivo}
                      </div>
                      <div className="text-[10px] text-stone-400">{formatarDataHora(e.criado_em)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Secao>
        </div>
      </div>
    </div>
  );
};

import React, { useMemo, useState } from 'react';
import { CheckCircle2, X, XCircle } from 'lucide-react';
import * as api from '../services/api';
import { ColunaGrade, Grade } from './Grade';
import { formatarDataHora } from '../utils/formatters';

interface RegistroLog {
  id: number;
  operacao: string;
  url: string;
  referencia: string | null;
  sucesso: number;
  codigo_status: string | null;
  motivo: string | null;
  duracao_ms: number;
  criado_em: string;
}

/**
 * Log de comunicação com as APIs dos bancos, na grade padrão do b2b admin.
 * Um clique seleciona a chamada e mostra o envio e o retorno abaixo da grade.
 */
export const LogView: React.FC = () => {
  const [selecionado, setSelecionado] = useState<RegistroLog | null>(null);
  const [detalhe, setDetalhe] = useState<{ id: number; envio: string; retorno: string; url: string } | null>(null);

  const selecionar = async (linha: RegistroLog | null) => {
    setSelecionado(linha);
    if (!linha) return setDetalhe(null);
    // O envio e o retorno são grandes: só vêm quando a linha é aberta
    if (detalhe?.id === linha.id) return;
    try {
      const completo = await api.buscarLog(linha.id);
      setDetalhe({ id: linha.id, envio: completo.envio, retorno: completo.retorno, url: completo.url });
    } catch {
      setDetalhe(null);
    }
  };

  const colunas = useMemo<ColunaGrade<RegistroLog>[]>(
    () => [
      { nome: 'criado_em', rotulo: 'Quando', tipo: 'data', valor: (l) => formatarDataHora(l.criado_em) },
      { nome: 'operacao', rotulo: 'Operação', valor: (l) => l.operacao },
      { nome: 'referencia', rotulo: 'Referência', valor: (l) => l.referencia || '—' },
      {
        nome: 'sucesso',
        rotulo: 'Resultado',
        tipo: 'centro',
        valor: (l) =>
          l.sucesso ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-500 inline" aria-label="Sucesso" />
          ) : (
            <XCircle className="w-4 h-4 text-red-500 inline" aria-label="Falha" />
          ),
      },
      { nome: 'codigo_status', rotulo: 'Status', tipo: 'numero', valor: (l) => l.codigo_status ?? '—' },
      { nome: 'duracao_ms', rotulo: 'Tempo (ms)', tipo: 'numero', valor: (l) => l.duracao_ms },
      { nome: 'motivo', rotulo: 'Retorno', valor: (l) => l.motivo || '—', dica: (l) => l.motivo || undefined },
    ],
    [],
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <Grade<RegistroLog>
        recurso="log"
        colunas={colunas}
        carregarPagina={api.listarLog}
        chave={(l) => l.id}
        ordemPadrao={{ campo: 'criado_em', direcao: 'desc' }}
        rotuloVazio="Nenhuma comunicação registrada"
        selecionada={selecionado}
        onSelecionar={selecionar}
      />

      {/* Mestre-detalhe: envio e retorno da chamada selecionada */}
      {selecionado && detalhe?.id === selecionado.id ? (
        <div className="border-t border-stone-200 dark:border-stone-800 shrink-0">
          <div className="px-4 py-2 flex items-center justify-between gap-3 bg-stone-50 dark:bg-stone-950/40 border-b border-stone-200 dark:border-stone-800">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 truncate">
              {selecionado.operacao} • {formatarDataHora(selecionado.criado_em)} • {detalhe.url}
            </span>
            <button
              type="button"
              onClick={() => selecionar(null)}
              title="Fechar o detalhe"
              className="p-1 rounded text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:text-rose-400 dark:hover:bg-rose-950/40 cursor-pointer shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2">
            {[
              ['Envio', detalhe.envio],
              ['Retorno', detalhe.retorno],
            ].map(([titulo, texto], i) => (
              <div key={titulo} className={i === 0 ? 'xl:border-r border-stone-200 dark:border-stone-800' : ''}>
                <div className="px-4 pt-2 text-[10px] font-semibold uppercase tracking-wider text-stone-400">{titulo}</div>
                <pre className="px-4 py-2 text-[10px] font-mono whitespace-pre-wrap break-all max-h-56 overflow-auto text-stone-700 dark:text-stone-300">
                  {texto || '—'}
                </pre>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="px-4 py-2 border-t border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950/40 text-[11px] text-stone-500 dark:text-stone-400 shrink-0">
          Clique numa chamada para ver o que foi enviado ao banco e a resposta aqui embaixo (segredos e tokens mascarados).
        </div>
      )}
    </div>
  );
};

import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { Andamento } from '../services/api';

/** Andamento de uma rotina demorada; sem total, a barra fica correndo */
export const ProgressoModal: React.FC<{ titulo: string; andamento: Andamento | null }> = ({ titulo, andamento }) => {
  const pct = andamento?.total ? Math.round((andamento.feitos / andamento.total) * 100) : null;
  return (
    // Acima dos diálogos (z-50) e abaixo dos avisos do canto (z-80)
    <div role="dialog" aria-modal="true" aria-label={titulo} className="fixed inset-0 z-[70] bg-stone-900/50 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="px-5 pt-4">
          <h3 className="text-sm font-bold text-stone-800 dark:text-stone-100">{titulo}</h3>
          <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">Aguarde até terminar</p>
        </div>
        <div className="px-5 pt-4 pb-5 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs text-stone-700 dark:text-stone-200">
            <Loader2 className="w-4 h-4 animate-spin shrink-0 text-blue-600" />
            <span className="flex-1">{andamento?.etapa || 'Iniciando…'}</span>
            {pct !== null && (
              <span className="tabular-nums text-stone-500 dark:text-stone-400">
                {andamento!.feitos} de {andamento!.total}
              </span>
            )}
          </div>
          <div
            className="h-2.5 rounded-full bg-stone-200 dark:bg-stone-700 overflow-hidden"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct ?? undefined}
          >
            {pct !== null ? (
              <div className="h-full bg-blue-600 transition-[width] duration-300" style={{ width: `${pct}%` }} />
            ) : (
              <div className="h-full w-1/3 bg-blue-600 rounded-full animate-[progresso_1.2s_ease-in-out_infinite]" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Modal de progresso das rotinas demoradas (renderize o `modal` devolvido).
 * - `aguardar`: uma chamada comum, com a barra correndo. Só aparece se passar de 300 ms,
 *   para não piscar no que é rápido.
 * - `acompanhar`: uma rota com andamento (rotaProgresso), com a contagem "x de y".
 */
export function useProgresso() {
  const [estado, setEstado] = useState<{ titulo: string; andamento: Andamento | null } | null>(null);

  const aguardar = async <T,>(titulo: string, etapa: string, fn: () => Promise<T>): Promise<T> => {
    const espera = setTimeout(() => setEstado({ titulo, andamento: { etapa, feitos: 0, total: 0 } }), 300);
    try {
      return await fn();
    } finally {
      clearTimeout(espera);
      setEstado(null);
    }
  };

  const acompanhar = async <T,>(titulo: string, fn: (aoAvancar: (a: Andamento) => void) => Promise<T>): Promise<T> => {
    setEstado({ titulo, andamento: null });
    try {
      return await fn((andamento) => setEstado({ titulo, andamento }));
    } finally {
      setEstado(null);
    }
  };

  const modal = estado && <ProgressoModal titulo={estado.titulo} andamento={estado.andamento} />;
  return { aguardar, acompanhar, modal };
}

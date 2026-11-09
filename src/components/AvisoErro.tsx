import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, AlertTriangle, X } from 'lucide-react';

interface AvisoErroProps {
  /** Texto do erro; o aviso some sozinho quando ele muda ou depois do tempo */
  mensagem: string;
  onFechar: () => void;
  /** Vermelho para erro (padrão), âmbar para alerta */
  tom?: 'erro' | 'alerta';
}

/** Pilha do canto inferior direito, fixa e por cima de tudo (diálogos inclusive): avisos e o toast do App */
function pilha(): HTMLElement {
  let el = document.getElementById('avisos-no-canto');
  if (!el) {
    el = document.createElement('div');
    el.id = 'avisos-no-canto';
    // Só os avisos recebem clique: o espaço vazio da pilha não tampa a tela
    el.className = 'fixed bottom-8 right-5 z-[80] w-[min(28rem,calc(100vw-2.5rem))] flex flex-col items-end gap-2 pointer-events-none';
    document.body.appendChild(el);
  }
  return el;
}

/** Mostra o conteúdo na pilha do canto (stay-on-top) */
export const NoCanto: React.FC<{ children: React.ReactNode }> = ({ children }) => createPortal(children, pilha());

/** Fecha sozinho depois do tempo; o relógio recomeça quando a mensagem muda */
function useFecharSozinho(mensagem: string, onFechar: () => void, segundos: number) {
  // Em ref para o relógio não reiniciar a cada render de quem usa o aviso
  const fechar = useRef(onFechar);
  fechar.current = onFechar;

  useEffect(() => {
    const t = setTimeout(() => fechar.current(), segundos * 1000);
    return () => clearTimeout(t);
  }, [mensagem, segundos]);
}

const CORES = {
  erro: {
    caixa: 'bg-rose-50 dark:bg-rose-950 border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300',
    icone: 'text-rose-600',
    fechar: 'text-rose-400 hover:text-rose-700 hover:bg-rose-100 dark:hover:bg-rose-900/60',
  },
  alerta: {
    caixa: 'bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-200',
    icone: 'text-amber-500',
    fechar: 'text-amber-400 hover:text-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/60',
  },
};

/** Aviso de erro ou alerta de uma ação, flutuando no canto: fecha no "x" ou sozinho depois de 10 segundos */
export const AvisoErro: React.FC<AvisoErroProps> = ({ mensagem, onFechar, tom = 'erro' }) => {
  useFecharSozinho(mensagem, onFechar, 10);
  const cor = CORES[tom];
  const Icone = tom === 'alerta' ? AlertTriangle : AlertCircle;

  return (
    <NoCanto>
      <div
        role="alert"
        className={`pointer-events-auto max-w-full p-3 rounded-xl shadow-2xl border flex items-start gap-2.5 text-xs ${cor.caixa}`}
      >
        <Icone className={`w-4 h-4 shrink-0 mt-0.5 ${cor.icone}`} />
        <span className="flex-1 min-w-0 whitespace-pre-line">{mensagem}</span>
        <button
          type="button"
          onClick={onFechar}
          title="Fechar aviso"
          className={`p-0.5 -mt-0.5 rounded shrink-0 cursor-pointer ${cor.fechar}`}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </NoCanto>
  );
};

/** Confirmação de uma ação que deu certo, na mesma pilha do canto: some sozinha depois de 6 segundos */
export const AvisoSucesso: React.FC<{ mensagem: string; onFechar: () => void }> = ({ mensagem, onFechar }) => {
  useFecharSozinho(mensagem, onFechar, 6);

  return (
    <NoCanto>
      <div
        role="status"
        className="pointer-events-auto bg-stone-900 text-white text-xs font-semibold py-3 px-4 rounded-xl shadow-2xl border border-stone-800 flex items-center gap-2.5"
      >
        <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
        <span>{mensagem}</span>
      </div>
    </NoCanto>
  );
};

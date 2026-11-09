import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, MoreHorizontal, type LucideIcon } from 'lucide-react';

/** Dentro do menu "...": as ações viram itens com nome em vez de ícones soltos */
const EmMenu = createContext(false);

type Tom = 'normal' | 'verde' | 'perigo';

interface AcaoProps {
  icone: LucideIcon;
  titulo: string;
  descricao: string;
  onClick: () => void;
  carregando?: boolean;
  tom?: Tom;
}

const HOVER_ICONE: Record<Tom, string> = {
  normal: 'hover:text-blue-600 hover:bg-blue-50 dark:hover:text-blue-400 dark:hover:bg-blue-950/40',
  verde: 'hover:text-emerald-600 hover:bg-emerald-50 dark:hover:text-emerald-400 dark:hover:bg-emerald-950/40',
  perigo: 'hover:text-rose-600 hover:bg-rose-50 dark:hover:text-rose-400 dark:hover:bg-rose-950/40',
};
const COR_ITEM: Record<Tom, string> = { normal: 'text-blue-600 dark:text-blue-400', verde: 'text-emerald-600 dark:text-emerald-400', perigo: 'text-rose-600 dark:text-rose-400' };

/** Ação de linha: ícone solto na coluna Ações (descrição no tooltip), ou item (ícone e nome) dentro do MenuAcoes */
export const BotaoAcao: React.FC<AcaoProps> = ({ icone: Icone, titulo, descricao, onClick, carregando, tom = 'normal' }) => {
  const emMenu = useContext(EmMenu);
  const clicar = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClick();
  };
  if (emMenu) {
    return (
      <button role="menuitem" type="button" onClick={clicar} disabled={carregando} className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer disabled:cursor-wait">
        {carregando ? <Loader2 className="w-4 h-4 shrink-0 animate-spin text-stone-400" /> : <Icone className={`w-4 h-4 shrink-0 ${COR_ITEM[tom]}`} />}
        <span className={`text-xs font-medium whitespace-nowrap ${tom === 'perigo' ? 'text-rose-700 dark:text-rose-400' : 'text-stone-800 dark:text-stone-100'}`}>{titulo}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={clicar}
      disabled={carregando}
      title={`${titulo}: ${descricao}`}
      className={`p-1 rounded text-stone-400 ${HOVER_ICONE[tom]} transition-colors cursor-pointer disabled:cursor-wait`}
    >
      {carregando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icone className="w-3.5 h-3.5" />}
    </button>
  );
};

/**
 * Botão "..." da coluna Ações que abre as ações da linha num menu. As ações ficam montadas depois
 * da primeira abertura: o menu fecha ao escolher, mas o diálogo que a ação abriu continua aberto.
 */
export const MenuAcoes: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const botao = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<React.CSSProperties | null>(null);
  const [montado, setMontado] = useState(false);

  useEffect(() => {
    if (!pos) return;
    const fechar = () => setPos(null);
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && fechar();
    document.addEventListener('mousedown', fechar);
    document.addEventListener('scroll', fechar, true);
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('mousedown', fechar);
      document.removeEventListener('scroll', fechar, true);
      document.removeEventListener('keydown', tecla);
    };
  }, [pos]);

  const abrir = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (pos) return setPos(null);
    const r = botao.current!.getBoundingClientRect();
    // Perto do pé da tela, abre para cima
    const vertical = r.bottom + 380 > window.innerHeight ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 };
    setPos({ ...vertical, right: window.innerWidth - r.right });
    setMontado(true);
  };

  return (
    <>
      <button
        ref={botao}
        type="button"
        onClick={abrir}
        title="Ações"
        className={`p-1 rounded transition-colors cursor-pointer ${pos ? 'text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-950/40' : 'text-stone-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:text-blue-400 dark:hover:bg-blue-950/40'}`}
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {montado &&
        // No body: dentro da célula fixa da coluna Ações ficaria cortado; o span segura os cliques da linha
        createPortal(
          <span onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
            <div
              role="menu"
              onMouseDown={(e) => e.stopPropagation()}
              onClickCapture={() => setPos(null)}
              style={pos ?? { display: 'none' }}
              className="fixed z-[60] min-w-48 py-1 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 shadow-xl"
            >
              <EmMenu.Provider value={true}>{children}</EmMenu.Provider>
            </div>
          </span>,
          document.body,
        )}
    </>
  );
};

/** Linha divisória entre grupos de itens do menu (fora do menu não aparece) */
export const SeparadorAcoes: React.FC = () => (useContext(EmMenu) ? <div className="my-1 border-t border-stone-100 dark:border-stone-800" /> : null);

/** Se está dentro do menu "..." (para ações que mudam de forma no menu) */
export const useEmMenu = () => useContext(EmMenu);

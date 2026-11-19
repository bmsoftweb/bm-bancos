import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Dica (tooltip) com o visual do app no lugar do `title` nativo do navegador, para o app inteiro: ao passar o
 * mouse, o `title` do elemento sai (o navegador não mostra o dele) e volta ao sair. `data-dica-desc` acrescenta
 * uma segunda linha (ex.: descrição da ação da linha). Aparece em cima do elemento; sem espaço, embaixo.
 */
export const Dica: React.FC = () => {
  const [dica, setDica] = useState<{ titulo: string; desc?: string; x: number; y: number; embaixo: boolean } | null>(null);
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alvo: HTMLElement | null = null;
    let timer: ReturnType<typeof setTimeout>;

    const soltar = () => {
      clearTimeout(timer);
      if (alvo?.dataset.dicaTitle !== undefined) {
        alvo.setAttribute('title', alvo.dataset.dicaTitle);
        delete alvo.dataset.dicaTitle;
      }
      alvo = null;
      setDica(null);
    };

    const sobre = (e: PointerEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>('[title]');
      if (el === alvo || (!el && alvo?.contains(e.target as Node))) return;
      soltar();
      if (!el) return;
      const titulo = el.getAttribute('title') || '';
      if (!titulo.trim()) return;
      alvo = el;
      el.dataset.dicaTitle = titulo;
      el.removeAttribute('title');
      timer = setTimeout(() => {
        if (alvo !== el || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        setDica({ titulo, desc: el.dataset.dicaDesc, x: r.left + r.width / 2, y: r.top < 60 ? r.bottom : r.top, embaixo: r.top < 60 });
      }, 350);
    };

    document.addEventListener('pointerover', sobre);
    document.addEventListener('pointerdown', soltar, true);
    window.addEventListener('scroll', soltar, true);
    return () => {
      document.removeEventListener('pointerover', sobre);
      document.removeEventListener('pointerdown', soltar, true);
      window.removeEventListener('scroll', soltar, true);
      soltar();
    };
  }, []);

  // Centralizada no elemento, sem passar da borda da tela (mede a largura real); a seta continua no centro do elemento
  useLayoutEffect(() => {
    const div = caixa.current;
    if (!div || !dica) return;
    const meia = div.offsetWidth / 2;
    const left = Math.min(Math.max(dica.x, meia + 8), window.innerWidth - meia - 8);
    div.style.left = `${left}px`;
    div.style.setProperty('--seta', `${dica.x - left}px`);
  }, [dica]);

  if (!dica) return null;
  return createPortal(
    <div
      ref={caixa}
      role="tooltip"
      style={{ left: dica.x, top: dica.y, transform: `translate(-50%, ${dica.embaixo ? '8px' : 'calc(-100% - 8px)'})` }}
      className="fixed z-[100] w-max max-w-64 pointer-events-none px-2.5 py-1.5 rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 shadow-lg text-[11px] leading-snug"
    >
      <div className={dica.desc ? 'font-semibold' : 'font-medium'}>{dica.titulo}</div>
      {dica.desc && <div className="text-stone-300 dark:text-stone-600 font-normal">{dica.desc}</div>}
      {/* Seta apontando para o elemento (fica no centro dele mesmo quando a dica encosta na borda) */}
      <span
        style={{ left: 'clamp(8px, calc(50% + var(--seta, 0px)), calc(100% - 8px))' }}
        className={`absolute size-2 -translate-x-1/2 rotate-45 bg-stone-900 dark:bg-stone-100 ${dica.embaixo ? '-top-1' : '-bottom-1'}`}
      />
    </div>,
    document.body,
  );
};

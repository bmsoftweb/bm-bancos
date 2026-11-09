import React from 'react';

interface ToggleProps {
  id?: string;
  checked: boolean;
  onChange: (valor: boolean) => void;
  /** Texto ao lado do interruptor; sem ele, mostra "Sim" / "Não" */
  label?: React.ReactNode;
  disabled?: boolean;
  title?: string;
  size?: 'sm' | 'md';
}

/** Interruptor liga/desliga: padrão para todo campo sim/não do painel */
export const Toggle: React.FC<ToggleProps> = ({
  id,
  checked,
  onChange,
  label,
  disabled,
  title,
  size = 'md',
}) => {
  const trilho = size === 'sm' ? 'w-8 h-4' : 'w-10 h-5';
  const botao = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4';

  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      title={title}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2.5 w-fit select-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none group"
    >
      <span
        className={`${trilho} shrink-0 rounded-full p-0.5 flex items-center transition-colors group-focus-visible:ring-2 group-focus-visible:ring-blue-500 group-focus-visible:ring-offset-1 ${
          checked ? 'bg-emerald-500 justify-end' : 'bg-stone-300 dark:bg-stone-600 justify-start'
        }`}
      >
        <span className={`${botao} rounded-full bg-white shadow-sm transition-transform`} />
      </span>
      <span
        className={`text-xs font-semibold ${
          label ? 'text-stone-600 dark:text-stone-400 font-medium' : checked ? 'text-emerald-700 dark:text-emerald-400' : 'text-stone-500 dark:text-stone-400'
        }`}
      >
        {label ?? (checked ? 'Sim' : 'Não')}
      </span>
    </button>
  );
};

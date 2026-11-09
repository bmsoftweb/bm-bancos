import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { ThemeMode } from '../utils/theme';

interface ThemeToggleProps {
  theme: ThemeMode;
  onToggle: () => void;
  variant?: 'header' | 'sidebar' | 'login';
  className?: string;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({
  theme,
  onToggle,
  variant = 'header',
  className = '',
}) => {
  const isDark = theme === 'dark';

  if (variant === 'sidebar') {
    return (
      <button
        type="button"
        id="bmbancos-sidebar-btn-theme-toggle"
        onClick={onToggle}
        title={isDark ? 'Mudar para Modo Claro' : 'Mudar para Modo Escuro'}
        className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all duration-200 cursor-pointer ${
          isDark
            ? 'bg-stone-800/80 hover:bg-stone-800 text-stone-300 border border-stone-700/60'
            : 'bg-stone-100 hover:bg-stone-200 text-stone-700 border border-stone-300/80'
        } ${className}`}
      >
        <div className="flex items-center gap-2">
          {isDark ? (
            <Moon className="w-4 h-4 text-indigo-400" />
          ) : (
            <Sun className="w-4 h-4 text-amber-500" />
          )}
          <span>Tema do Sistema</span>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold text-stone-400">
            {isDark ? 'Escuro' : 'Claro'}
          </span>
          <div
            className={`w-7 h-4 rounded-full p-0.5 transition-colors duration-200 flex items-center ${
              isDark ? 'bg-indigo-600 justify-end' : 'bg-stone-300 dark:bg-stone-600 justify-start'
            }`}
          >
            <div className="w-3 h-3 rounded-full bg-white shadow-xs" />
          </div>
        </div>
      </button>
    );
  }

  // Header or Login button
  return (
    <button
      type="button"
      id={variant === 'login' ? 'login-btn-theme-toggle' : 'header-btn-theme-toggle'}
      onClick={onToggle}
      aria-label={isDark ? 'Ativar modo claro' : 'Ativar modo escuro'}
      title={isDark ? 'Ativar modo claro (Iluminação padrão)' : 'Ativar modo escuro (Descanso visual)'}
      className={`relative p-2 rounded-xl transition-all duration-200 flex items-center justify-center cursor-pointer border shadow-xs ${
        variant === 'login'
          ? isDark
            ? 'bg-stone-900/90 text-amber-400 border-stone-800 hover:bg-stone-800'
            : 'bg-white/90 text-stone-700 border-stone-200 hover:bg-stone-50'
          : isDark
          ? 'bg-stone-800 text-amber-400 border-stone-700 hover:bg-stone-700 hover:text-amber-300'
          : 'bg-stone-50 text-stone-600 border-stone-200 hover:bg-stone-100 hover:text-stone-900'
      } ${className}`}
    >
      {isDark ? (
        <Sun className="w-4 h-4 text-amber-400 transition-transform rotate-0 hover:rotate-45" />
      ) : (
        <Moon className="w-4 h-4 text-stone-600 transition-transform -rotate-12 hover:rotate-0" />
      )}
    </button>
  );
};

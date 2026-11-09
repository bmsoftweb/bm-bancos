import React from 'react';
import { Database, Menu, RefreshCw } from 'lucide-react';
import { Empresa, StatusBanco } from '../types';
import { ThemeToggle } from './ThemeToggle';
import { ThemeMode } from '../utils/theme';
import { formatarCnpj } from '../utils/formatters';

interface HeaderProps {
  titulo: string;
  subtitulo?: string;
  empresa: Empresa;
  statusBanco: StatusBanco | null;
  tema: ThemeMode;
  onAlternarTema: () => void;
  onAtualizar: () => void;
  onAbrirMenuMobile: () => void;
}

export const Header: React.FC<HeaderProps> = ({ titulo, subtitulo, empresa, statusBanco, tema, onAlternarTema, onAtualizar, onAbrirMenuMobile }) => (
  <header
    className="shrink-0 bg-white dark:bg-stone-900 border-b border-stone-200 dark:border-stone-800 px-4 sm:px-6 flex items-center justify-between gap-4"
    style={{ height: 'var(--altura-topo)' }}
  >
    <div className="flex items-center gap-3 min-w-0">
      <button type="button" onClick={onAbrirMenuMobile} className="lg:hidden text-stone-500 hover:text-stone-800 dark:text-stone-400 cursor-pointer">
        <Menu className="w-5 h-5" />
      </button>
      <div className="min-w-0">
        <h1 className="text-sm font-bold text-stone-800 dark:text-stone-100 truncate">{titulo}</h1>
        {subtitulo && <p className="text-[11px] text-stone-500 dark:text-stone-400 truncate">{subtitulo}</p>}
      </div>
    </div>

    <div className="flex items-center gap-2 sm:gap-3">
      <div
        className="hidden md:flex items-center gap-1.5 text-[11px] text-stone-500 dark:text-stone-400"
        title={statusBanco?.connected ? `${statusBanco.database} • ${statusBanco.latencyMs}ms` : statusBanco?.error}
      >
        <Database className={`w-4 h-4 ${statusBanco?.connected ? 'text-emerald-500' : 'text-red-500'}`} />
      </div>

      <div className="hidden sm:block text-right min-w-0">
        <div className="text-xs font-semibold text-stone-700 dark:text-stone-200 truncate max-w-[220px]">{empresa.razao_social}</div>
        <div className="text-[10px] text-stone-500 dark:text-stone-400">{formatarCnpj(empresa.cnpj)}</div>
      </div>

      <button
        type="button"
        onClick={onAtualizar}
        title="Atualizar"
        className="p-2 rounded-xl border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700 cursor-pointer"
      >
        <RefreshCw className="w-4 h-4" />
      </button>

      <ThemeToggle theme={tema} onToggle={onAlternarTema} />
    </div>
  </header>
);

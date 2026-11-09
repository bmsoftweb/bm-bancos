import React, { useEffect, useRef, useState } from 'react';
import { Eye, X, type LucideIcon } from 'lucide-react';
import * as api from '../services/api';
import { Conta } from '../types';
import { Etiqueta, Selecao } from './ui';

// ---------------------------------------------------------------------------
// Abas filhas (MDI): a grade fica na primeira; inclusão, edição e detalhe
// abrem cada um numa aba com X, que fecha e volta à grade
// ---------------------------------------------------------------------------

export interface AbaFilha {
  id: string;
  titulo: string;
  icone?: LucideIcon;
}

export function useAbasFilhas<A extends AbaFilha>() {
  const [abas, setAbas] = useState<A[]>([]);
  const [ativa, setAtiva] = useState('grade');
  /** Abre ou, se já estiver aberta, só mostra */
  const abrir = (aba: A) => {
    setAbas((a) => (a.some((x) => x.id === aba.id) ? a : [...a, aba]));
    setAtiva(aba.id);
  };
  const fechar = (id: string) => {
    setAbas((a) => a.filter((x) => x.id !== id));
    setAtiva('grade');
  };
  return { abas, ativa, setAtiva, abrir, fechar };
}

/** Faixa das abas filhas; só aparece com alguma filha aberta */
export const FaixaAbasFilhas: React.FC<{
  rotulo: string;
  icone: LucideIcon;
  abas: AbaFilha[];
  ativa: string;
  onAtivar: (id: string) => void;
  onFechar: (id: string) => void;
}> = ({ rotulo, icone: IconeGrade, abas, ativa, onAtivar, onFechar }) => {
  if (!abas.length) return null;
  return (
    <div className="flex items-stretch bg-stone-100 dark:bg-stone-950 border-b border-stone-200 dark:border-stone-800 overflow-x-auto overflow-y-hidden shrink-0">
      <button
        type="button"
        onClick={() => onAtivar('grade')}
        className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold whitespace-nowrap border-r border-stone-200 dark:border-stone-800 border-b-2 transition-colors cursor-pointer ${
          ativa === 'grade'
            ? 'bg-white dark:bg-stone-900 text-blue-700 dark:text-blue-400 border-b-blue-600'
            : 'border-b-transparent text-stone-600 dark:text-stone-400 hover:bg-stone-200/60 dark:hover:bg-stone-800/60'
        }`}
      >
        <IconeGrade className="w-3.5 h-3.5" />
        <span>{rotulo}</span>
      </button>
      {abas.map(({ id, titulo, icone: Icone = Eye }) => (
        <div
          key={id}
          className={`flex items-center gap-1.5 pl-4 pr-2 border-r border-stone-200 dark:border-stone-800 border-b-2 transition-colors ${
            ativa === id ? 'bg-white dark:bg-stone-900 border-b-blue-600' : 'border-b-transparent hover:bg-stone-200/60 dark:hover:bg-stone-800/60'
          }`}
        >
          <button
            type="button"
            onClick={() => onAtivar(id)}
            className={`flex items-center gap-2 py-2.5 text-xs font-semibold whitespace-nowrap cursor-pointer ${
              ativa === id ? 'text-blue-700 dark:text-blue-400' : 'text-stone-600 dark:text-stone-400'
            }`}
          >
            <Icone className="w-3.5 h-3.5" />
            <span>{titulo}</span>
          </button>
          <button
            type="button"
            onClick={() => onFechar(id)}
            title="Fechar aba"
            className="p-1 rounded text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:text-rose-400 dark:hover:bg-rose-950/40 transition-colors cursor-pointer shrink-0"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}
    </div>
  );
};

/** Contas de cobrança da empresa, para os seletores das telas */
export function useContas(versao = 0) {
  const [contas, setContas] = useState<Conta[]>([]);
  useEffect(() => {
    api.listarContas().then(setContas).catch(() => setContas([]));
  }, [versao]);
  return contas;
}

export const nomeConta = (c: Conta) => `${c.descricao} (${c.banco_codigo})`;

/** Select de conta; `todas` acrescenta a opção vazia de filtro */
export const SeletorConta: React.FC<{
  contas: Conta[];
  valor: number | '';
  onTrocar: (id: number | '') => void;
  todas?: string;
  rotulo?: string;
  className?: string;
}> = ({ contas, valor, onTrocar, todas, rotulo, className = 'w-56' }) => (
  <Selecao
    rotulo={rotulo}
    className={className}
    value={valor}
    onChange={(e) => onTrocar(e.target.value ? Number(e.target.value) : '')}
    opcoes={[
      ...(todas ? [{ valor: '', rotulo: todas }] : []),
      ...contas.filter((c) => c.ativo || c.id === valor).map((c) => ({ valor: c.id, rotulo: nomeConta(c) })),
    ]}
  />
);

/** Etiqueta colorida a partir de um mapa (situação, tipo...) */
export const etiqueta = (mapa: Record<string, { rotulo: string; classe: string }>, valor: string) => {
  const e = mapa[valor] || { rotulo: valor, classe: 'bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300' };
  return <Etiqueta texto={e.rotulo} classe={e.classe} />;
};

/** Janela modal das ações (Esc e X fecham, menos enquanto `ocupado`) */
export const Dialogo: React.FC<{
  titulo: string;
  descricao?: React.ReactNode;
  children?: React.ReactNode;
  rodape: React.ReactNode;
  onFechar: () => void;
  ocupado?: boolean;
  largura?: string;
}> = ({ titulo, descricao, children, rodape, onFechar, ocupado, largura = 'max-w-lg' }) => {
  const fechar = useRef(onFechar);
  fechar.current = onFechar;
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && !ocupado && fechar.current();
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [ocupado]);

  return (
    <div className="fixed inset-0 z-50 bg-stone-900/50 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className={`bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl shadow-2xl w-full ${largura} max-h-[90vh] flex flex-col`}>
        <div className="px-5 py-4 flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-stone-800 dark:text-stone-100">{titulo}</h3>
            {descricao && <div className="text-xs text-stone-600 dark:text-stone-300 mt-1">{descricao}</div>}
          </div>
          <button type="button" onClick={onFechar} disabled={ocupado} className="text-stone-400 hover:text-stone-700 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        {children && <div className="px-5 pb-4 flex flex-col gap-3 overflow-y-auto">{children}</div>}
        <div className="px-5 py-3 border-t border-stone-200 dark:border-stone-800 flex justify-end gap-2 shrink-0">{rodape}</div>
      </div>
    </div>
  );
};

/** Botão que abre o seletor de arquivo do sistema e devolve o escolhido */
export const EscolherArquivo: React.FC<{
  aceitar: string;
  onEscolher: (arquivo: File) => void;
  children: (abrir: () => void) => React.ReactNode;
}> = ({ aceitar, onEscolher, children }) => {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={aceitar}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onEscolher(f);
        }}
      />
      {children(() => input.current?.click())}
    </>
  );
};

/** Ação com erro no canto e sucesso no toast: { ocupado, erro, feito, executar } */
export function useAcao() {
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);
  const executar = async (chave: string, acao: () => Promise<string | void>) => {
    setOcupado(chave);
    setErro(null);
    try {
      const msg = await acao();
      if (msg) setFeito(msg);
      return true;
    } catch (err: any) {
      setErro(err.message || String(err));
      return false;
    } finally {
      setOcupado(null);
    }
  };
  return { ocupado, erro, setErro, feito, setFeito, executar };
}

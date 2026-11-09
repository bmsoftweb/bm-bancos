import React from 'react';
import {
  LayoutDashboard, FileText, ScrollText, LogOut, X, User, FileUp, FileDown, Bell, Scale, Landmark, KeyRound, type LucideIcon,
} from 'lucide-react';
import { Usuario } from '../types';

export interface ItemMenu {
  id: string;
  rotulo: string;
  icone: LucideIcon;
  grupo: string;
}

export const MENU: ItemMenu[] = [
  { id: 'painel', rotulo: 'Painel', icone: LayoutDashboard, grupo: 'Início' },
  { id: 'boletos', rotulo: 'Boletos', icone: FileText, grupo: 'Cobrança' },
  { id: 'remessas', rotulo: 'Remessas', icone: FileUp, grupo: 'Cobrança' },
  { id: 'retornos', rotulo: 'Retornos', icone: FileDown, grupo: 'Cobrança' },
  { id: 'ocorrencias', rotulo: 'Ocorrências', icone: Bell, grupo: 'Cobrança' },
  { id: 'extratos', rotulo: 'Extratos e conciliação', icone: Scale, grupo: 'Conciliação' },
  { id: 'contas', rotulo: 'Contas de cobrança', icone: Landmark, grupo: 'Sistema' },
  { id: 'chaves', rotulo: 'Chaves de API', icone: KeyRound, grupo: 'Sistema' },
  { id: 'log', rotulo: 'Log de Comunicação', icone: ScrollText, grupo: 'Sistema' },
];

const ORDEM_GRUPOS = ['Início', 'Cobrança', 'Conciliação', 'Sistema'];

interface SidebarProps {
  abaAtiva: string;
  onTrocarAba: (id: string) => void;
  contagens: Record<string, number>;
  usuario: Usuario | null;
  razaoSocial: string;
  onSair: () => void;
  abertaNoMobile: boolean;
  onFecharMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  abaAtiva,
  onTrocarAba,
  contagens,
  usuario,
  razaoSocial,
  onSair,
  abertaNoMobile,
  onFecharMobile,
}) => {
  const clicar = (id: string) => {
    onTrocarAba(id);
    onFecharMobile();
  };

  const conteudo = (
    <>
      <div
        className="flex items-center justify-between px-4 border-b border-stone-200 dark:border-stone-800 shrink-0"
        style={{ height: 'var(--altura-topo)' }}
      >
        <div className="min-w-0">
          <div className="text-sm font-bold text-stone-800 dark:text-stone-100">BMBancos</div>
          <div className="text-[11px] text-stone-500 dark:text-stone-400 truncate">{razaoSocial}</div>
        </div>
        <button
          type="button"
          onClick={onFecharMobile}
          className="lg:hidden text-stone-400 hover:text-stone-700 cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto py-2">
        {ORDEM_GRUPOS.map((grupo) => {
          const itens = MENU.filter((m) => m.grupo === grupo);
          if (!itens.length) return null;

          return (
            <div key={grupo} className="mb-1">
              <div className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                {grupo}
              </div>
              {itens.map(({ id, rotulo, icone: Icone }) => {
                const ativo = abaAtiva === id;
                const badge = contagens[id];

                return (
                  <button
                    key={id}
                    type="button"
                    id={`sidebar-nav-${id}`}
                    onClick={() => clicar(id)}
                    className={`w-full flex items-center justify-between px-4 py-[11px] text-left transition-colors cursor-pointer group border-l-2 ${
                      ativo
                        ? 'border-blue-600 bg-blue-50 text-blue-700 font-semibold dark:border-blue-400 dark:bg-blue-950/40 dark:text-blue-300'
                        : 'border-transparent text-stone-600 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-800/70 dark:hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Icone
                        className={`w-4 h-4 shrink-0 transition-transform group-hover:scale-110 ${
                          ativo
                            ? 'text-blue-600 dark:text-blue-300'
                            : 'text-stone-400 group-hover:text-blue-600 dark:text-stone-400 dark:group-hover:text-blue-400'
                        }`}
                      />
                      <span className="text-xs truncate">{rotulo}</span>
                    </div>

                    {badge !== undefined && badge > 0 && (
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
                          ativo
                            ? 'bg-blue-200 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                            : 'bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300'
                        }`}
                      >
                        {badge > 999 ? '999+' : badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* Usuário & sair: padrão do crmWeb, com o sair ao lado do usuário */}
      <div className="p-3 border-t border-stone-200 dark:border-stone-800/80 flex items-center justify-between gap-2 bg-stone-50 dark:bg-stone-950/60 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-stone-100 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-700 dark:text-stone-300 flex items-center justify-center font-semibold text-xs shrink-0">
            {usuario?.nome ? usuario.nome.charAt(0).toUpperCase() : <User className="w-4 h-4" />}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-stone-900 dark:text-white truncate leading-tight">
              {usuario?.nome || 'Usuário'}
            </div>
            <div className="text-[10px] text-stone-500 dark:text-stone-400 truncate mt-0.5">
              {usuario?.cargo || usuario?.email}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onSair}
          title="Encerrar sessão"
          className="p-1.5 rounded-lg text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:text-rose-400 dark:hover:bg-rose-950/50 transition-colors cursor-pointer shrink-0"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </>
  );

  return (
    <>
      <aside className="hidden lg:flex w-60 shrink-0 flex-col bg-white dark:bg-stone-900 border-r border-stone-200 dark:border-stone-800">
        {conteudo}
      </aside>

      {abertaNoMobile && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div className="absolute inset-0 bg-stone-900/50" onClick={onFecharMobile} />
          <aside className="relative w-64 flex flex-col bg-white dark:bg-stone-900 border-r border-stone-200 dark:border-stone-800">
            {conteudo}
          </aside>
        </div>
      )}
    </>
  );
};

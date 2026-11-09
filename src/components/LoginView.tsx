import React, { useState } from 'react';
import { ArrowRight, Building2, Eye, EyeOff, Landmark, Lock, User } from 'lucide-react';
import { Empresa, Usuario } from '../types';
import { entrar } from '../services/api';
import { INPUT_CLASS_LG } from '../utils/formStyles';
import { ThemeToggle } from './ThemeToggle';
import { ThemeMode } from '../utils/theme';
import { Toggle } from './Toggle';
import { Confirmacao } from './ui';
import { AvisoErro } from './AvisoErro';
import { lerLembrete, limparLembrete, limparSessao, salvarLembrete } from '../utils/session';
import { formatarCnpj } from '../utils/formatters';

/** Versão do package.json, injetada pelo vite.config.ts */
declare const __APP_VERSION__: string;

interface LoginViewProps {
  tema: ThemeMode;
  onAlternarTema: () => void;
  avisoInicial?: string | null;
  onEntrou: (usuario: Usuario, empresa: Empresa, token: string, lembrar: boolean) => void;
}

const ROTULO = 'block text-[10px] font-bold uppercase tracking-widest ml-1 mb-1.5 text-stone-400 dark:text-stone-500';
const ICONE_CAMPO = 'absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 dark:text-stone-500 pointer-events-none';
const selecionar = (e: React.FocusEvent<HTMLInputElement>) => e.target.select();

export const LoginView: React.FC<LoginViewProps> = ({ tema, onAlternarTema, avisoInicial, onEntrou }) => {
  // Um lembrete salvo pré-preenche CNPJ e usuário e já deixa a opção marcada
  const [lembrete] = useState(() => lerLembrete());
  const [cnpj, setCnpj] = useState(() => (lembrete ? formatarCnpj(lembrete.cnpj) : ''));
  const [usuario, setUsuario] = useState(() => lembrete?.usuario || '');
  const [senha, setSenha] = useState('');
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [lembrar, setLembrar] = useState(() => !!lembrete);
  /** Há CNPJ/usuário guardados neste navegador */
  const [temDados, setTemDados] = useState(() => !!lembrete);
  const [limpando, setLimpando] = useState(false);
  const [erro, setErro] = useState<string | null>(avisoInicial || null);
  const [enviando, setEnviando] = useState(false);

  // O foco abre no primeiro campo ainda vazio
  const [foco] = useState(() => (!cnpj ? 'cnpj' : !usuario ? 'usuario' : 'senha'));

  const submeter = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);
    setEnviando(true);

    try {
      const cnpjLimpo = cnpj.replace(/\D/g, '');
      const resposta = await entrar(cnpjLimpo, usuario, senha);

      if (lembrar) salvarLembrete({ cnpj: cnpjLimpo, usuario });
      else limparLembrete();
      setTemDados(lembrar);

      onEntrou(resposta.usuario, resposta.empresa, resposta.token, lembrar);
    } catch (err: any) {
      setErro(err.message || 'Não foi possível validar o acesso. Tente novamente.');
    } finally {
      setEnviando(false);
    }
  };

  /** Marca: ícone + nome, usada no painel esquerdo e, no celular, acima do formulário */
  const marca = (
    <div className="flex items-center gap-2.5">
      <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-200/50 dark:shadow-none shrink-0">
        <Landmark className="w-5 h-5 text-white" />
      </div>
      <span className="text-sm font-black tracking-wider text-stone-800 dark:text-stone-100">BMBancos</span>
    </div>
  );

  return (
    <div className="min-h-screen flex relative bg-white dark:bg-stone-900 text-stone-900 dark:text-white font-sans antialiased">
      {/* Painel esquerdo: identidade visual (oculto em telas pequenas) */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden flex-col p-12 bg-white dark:bg-stone-950 isolate">
        {/* Pano de fundo: boleto com o código de barras */}
        <div className="absolute inset-0 -z-10 pointer-events-none overflow-hidden">
          <svg
            viewBox="0 0 380 470"
            aria-hidden="true"
            className="absolute top-1/2 right-[6%] -translate-y-1/2 w-[min(440px,70%)] text-indigo-200 dark:text-indigo-400/25"
          >
            {/* Boleto de trás, inclinado */}
            <rect x="40" y="40" width="230" height="330" rx="16" fill="currentColor" opacity=".3" transform="rotate(-7 155 205)" />
            {/* Boleto: logo do banco, linha digitável, campos e o código de barras no pé */}
            <g fill="currentColor">
              <rect x="80" y="50" width="230" height="340" rx="16" opacity=".45" />
              <rect x="104" y="76" width="56" height="28" rx="6" opacity=".9" />
              <rect x="172" y="84" width="114" height="10" rx="5" opacity=".8" />
              {[140, 165, 190, 215, 240, 265].map((y, i) => (
                <rect key={y} x="104" y={y} width={[182, 120, 150, 170, 96, 140][i]} height="8" rx="4" opacity=".6" />
              ))}
            </g>
            {/* Código de barras: o tracejado da linha faz as barras */}
            <line x1="104" y1="330" x2="286" y2="330" stroke="currentColor" strokeWidth="40" strokeDasharray="3 2 1 2 4 3 2 2 1 3 3 2 1 2 2 3 4 2 1 2" />
          </svg>
          <div className="absolute top-[15%] left-[10%] w-[280px] h-[280px] rounded-[40%] rotate-12 blur-3xl bg-indigo-100/70 dark:bg-indigo-500/10" />
          <div className="absolute bottom-[10%] right-[5%] w-[220px] h-[220px] rounded-[45%] -rotate-12 blur-2xl bg-blue-100/60 dark:bg-blue-500/10" />
        </div>

        {marca}

        <div className="flex-1 flex flex-col justify-center">
          <h1 className="text-6xl font-black leading-[0.95] tracking-tight text-stone-900 dark:text-white">Bancos</h1>
          <p className="mt-4 text-sm font-medium max-w-xs text-stone-500 dark:text-stone-400">
            Boletos, remessa e retorno CNAB, APIs dos bancos e conciliação por OFX.
          </p>
        </div>
      </div>

      {/* Painel direito: formulário de login */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 relative bg-stone-50 dark:bg-stone-900">
        <div className="absolute top-6 right-6 z-20">
          <ThemeToggle theme={tema} onToggle={onAlternarTema} variant="login" />
        </div>

        <div className="w-full max-w-md">
          {/* Marca no celular (o painel esquerdo fica oculto) */}
          <div className="flex lg:hidden mb-8">{marca}</div>

          <h2 className="text-3xl font-black tracking-tight text-stone-900 dark:text-white">Login</h2>
          <p className="text-sm font-medium mt-1.5 text-stone-500 dark:text-stone-400">
            Informe o CNPJ da empresa, o seu usuário e a senha. No primeiro acesso, a senha digitada passa a ser a sua.
          </p>

          <form onSubmit={submeter} className="flex flex-col gap-5 mt-8">
            {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}

            <div>
              <label htmlFor="login-cnpj" className={ROTULO}>CNPJ da empresa</label>
              <div className="relative">
                <Building2 className={ICONE_CAMPO} />
                <input
                  id="login-cnpj"
                  required
                  autoFocus={foco === 'cnpj'}
                  onFocus={selecionar}
                  inputMode="numeric"
                  placeholder="00.000.000/0000-00"
                  value={cnpj}
                  onChange={(e) => {
                    setCnpj(formatarCnpj(e.target.value.replace(/\D/g, '').slice(0, 14)) || e.target.value);
                    setErro(null);
                  }}
                  className={`${INPUT_CLASS_LG} w-full pl-11`}
                />
              </div>
            </div>

            <div>
              <label htmlFor="login-usuario" className={ROTULO}>Usuário</label>
              <div className="relative">
                <User className={ICONE_CAMPO} />
                <input
                  id="login-usuario"
                  required
                  autoFocus={foco === 'usuario'}
                  onFocus={selecionar}
                  autoComplete="username"
                  value={usuario}
                  onChange={(e) => {
                    setUsuario(e.target.value);
                    setErro(null);
                  }}
                  className={`${INPUT_CLASS_LG} w-full pl-11`}
                />
              </div>
            </div>

            <div>
              <label htmlFor="login-senha" className={ROTULO}>Senha</label>
              <div className="relative">
                <Lock className={ICONE_CAMPO} />
                <input
                  id="login-senha"
                  type={mostrarSenha ? 'text' : 'password'}
                  required
                  autoFocus={foco === 'senha'}
                  onFocus={selecionar}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={senha}
                  onChange={(e) => {
                    setSenha(e.target.value);
                    setErro(null);
                  }}
                  className={`${INPUT_CLASS_LG} w-full pl-11 pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setMostrarSenha(!mostrarSenha)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 cursor-pointer"
                  tabIndex={-1}
                  title={mostrarSenha ? 'Esconder a senha' : 'Mostrar a senha'}
                >
                  {mostrarSenha ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 py-1">
              <Toggle
                id="login-lembrar"
                checked={lembrar}
                onChange={setLembrar}
                size="sm"
                label={<span className="text-xs font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400">Lembrar neste dispositivo</span>}
                title="Mantém a sessão ativa ao fechar o navegador e já traz o CNPJ e o usuário preenchidos no próximo acesso."
              />
              {temDados && (
                <button
                  type="button"
                  onClick={() => setLimpando(true)}
                  title="Apaga o CNPJ, o usuário e a sessão guardados neste navegador"
                  className="text-xs font-bold text-stone-500 hover:text-rose-600 dark:text-stone-400 dark:hover:text-rose-400 cursor-pointer shrink-0"
                >
                  Limpar
                </button>
              )}
            </div>

            <button
              id="btn-login-submit"
              type="submit"
              disabled={enviando}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-indigo-200 dark:shadow-none transition-all flex items-center justify-center gap-2 mt-2 group disabled:opacity-70 cursor-pointer"
            >
              {enviando ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <span className="uppercase tracking-wide">Entrar</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>
          </form>

          <div className="flex items-center justify-between mt-8 pt-4 border-t border-stone-200 dark:border-stone-800 text-[10px] font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">
            <span>BMBancos by BMsoft Sistemas</span>
            <span className="normal-case">v{__APP_VERSION__} • © {new Date().getFullYear()}</span>
          </div>
        </div>
      </div>

      <Confirmacao
        aberto={limpando}
        titulo="Limpar os dados deste dispositivo?"
        mensagem="Apaga o CNPJ, o usuário e a sessão guardados neste navegador. Você precisará digitar tudo de novo no próximo acesso."
        rotuloConfirmar="Limpar"
        onConfirmar={() => {
          limparLembrete();
          limparSessao();
          setCnpj('');
          setUsuario('');
          setSenha('');
          setLembrar(false);
          setTemDados(false);
          setLimpando(false);
        }}
        onCancelar={() => setLimpando(false)}
      />
    </div>
  );
};

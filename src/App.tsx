import React, { useCallback, useEffect, useState } from 'react';
import { Empresa, Painel, StatusBanco, Usuario } from './types';
import * as api from './services/api';
import { ThemeMode, applyTheme, getInitialTheme } from './utils/theme';
import { lerSessao, limparSessao, salvarSessao } from './utils/session';
import { limparConfigListas } from './utils/configListas';
import { MENU, Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { LoginView } from './components/LoginView';
import { Dashboard } from './components/Dashboard';
import { BoletosView } from './components/BoletosView';
import { OcorrenciasView, RemessasView, RetornosView } from './components/ArquivosView';
import { ExtratosView } from './components/ExtratosView';
import { ContasView } from './components/ContasView';
import { ChavesView } from './components/ChavesView';
import { LogView } from './components/LogView';

const SUBTITULOS: Record<string, string> = {
  painel: 'Cobrança em aberto, pendências e últimas ocorrências',
  boletos: 'Emissão, registro, instruções e PDF dos boletos',
  remessas: 'Arquivos CNAB com as entradas e instruções para enviar ao banco',
  retornos: 'Arquivos CNAB de retorno importados',
  ocorrencias: 'Tudo o que o banco informou: entradas, liquidações, baixas e rejeições',
  extratos: 'Extratos OFX e conciliação dos lançamentos',
  contas: 'Convênios, padrões do boleto e credenciais das APIs dos bancos',
  chaves: 'Acesso dos módulos do ERP ao BMBancos',
  log: 'Histórico de comunicação com as APIs dos bancos',
};

export default function App() {
  // Tema
  const [tema, setTema] = useState<ThemeMode>(() => getInitialTheme());
  useEffect(() => { applyTheme(tema); }, [tema]);
  const alternarTema = useCallback(() => setTema((t) => (t === 'dark' ? 'light' : 'dark')), []);

  // Sessão
  const [sessaoSalva] = useState(() => {
    const salva = lerSessao();
    // O token precisa estar no cliente HTTP antes das primeiras chamadas do painel
    api.definirToken(salva.token);
    return salva;
  });
  const [usuario, setUsuario] = useState<Usuario | null>(sessaoSalva.usuario);
  const [empresa, setEmpresa] = useState<Empresa | null>(sessaoSalva.empresa);
  /** Motivo mostrado na tela de login quando a sessão expira ou é revogada */
  const [avisoLogin, setAvisoLogin] = useState<string | null>(null);

  // Estado geral
  const [abaAtiva, setAbaAtiva] = useState('painel');
  const [menuMobile, setMenuMobile] = useState(false);
  const [painel, setPainel] = useState<Painel | null>(null);
  const [statusBanco, setStatusBanco] = useState<StatusBanco | null>(null);

  const recarregar = useCallback(() => {
    if (!empresa) return;
    api.buscarStatusBanco().then(setStatusBanco).catch(() => setStatusBanco(null));
    api.buscarPainel().then(setPainel).catch(() => setPainel(null));
  }, [empresa?.id]);

  useEffect(() => { recarregar(); }, [recarregar]);

  const sair = useCallback(() => {
    setUsuario(null);
    setEmpresa(null);
    setPainel(null);
    setAbaAtiva('painel');
    api.definirToken(null);
    // As preferências das grades são do usuário que saiu
    limparConfigListas();
    limparSessao();
  }, []);

  // Token vencido (12 h) ou acesso revogado: o servidor responde 401 e volta ao login
  useEffect(() => {
    api.aoExpirarSessao((mensagem) => {
      sair();
      setAvisoLogin(mensagem);
    });
  }, [sair]);

  if (!usuario || !empresa) {
    return (
      <LoginView
        tema={tema}
        onAlternarTema={alternarTema}
        avisoInicial={avisoLogin}
        onEntrou={(novoUsuario, novaEmpresa, token, lembrar) => {
          api.definirToken(token);
          setUsuario(novoUsuario);
          setEmpresa(novaEmpresa);
          salvarSessao(novoUsuario, novaEmpresa, token, lembrar);
          setAvisoLogin(null);
          setAbaAtiva('painel');
        }}
      />
    );
  }

  const item = MENU.find((m) => m.id === abaAtiva);
  const p = painel?.pendencias;
  const contagens: Record<string, number> = {
    remessas: Number(p?.boletos_remessa ?? 0) + Number(p?.instrucoes_remessa ?? 0),
    ocorrencias: Number(p?.ocorrencias_sem_boleto ?? 0),
    extratos: Number(p?.lancamentos_pendentes ?? 0),
  };

  return (
    <div className="h-screen overflow-hidden bg-stone-100/70 dark:bg-stone-950 text-stone-900 dark:text-stone-100 flex font-sans antialiased selection:bg-blue-600 selection:text-white">
      <Sidebar
        abaAtiva={abaAtiva}
        onTrocarAba={setAbaAtiva}
        contagens={contagens}
        usuario={usuario}
        razaoSocial={empresa.nome_fantasia || empresa.razao_social}
        onSair={sair}
        abertaNoMobile={menuMobile}
        onFecharMobile={() => setMenuMobile(false)}
      />

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <Header
          titulo={item?.rotulo || 'BMBancos'}
          subtitulo={SUBTITULOS[abaAtiva]}
          empresa={empresa}
          statusBanco={statusBanco}
          tema={tema}
          onAlternarTema={alternarTema}
          onAtualizar={recarregar}
          onAbrirMenuMobile={() => setMenuMobile(true)}
        />

        {abaAtiva === 'painel' ? (
          // O painel é o único com margem e cartões
          <main className="flex-1 overflow-y-auto min-h-0">
            <div className="px-4 sm:px-6 py-5">
              <Dashboard painel={painel} statusBanco={statusBanco} onNavegar={setAbaAtiva} />
            </div>
          </main>
        ) : (
          // As demais telas seguem o b2b admin: ocupam toda a área útil, chapadas, sem margem
          <main className="flex-1 flex flex-col overflow-y-auto min-h-0 bg-white dark:bg-stone-900">
            {abaAtiva === 'boletos' && <BoletosView onMudou={recarregar} />}
            {abaAtiva === 'remessas' && <RemessasView onMudou={recarregar} />}
            {abaAtiva === 'retornos' && <RetornosView onMudou={recarregar} />}
            {abaAtiva === 'ocorrencias' && <OcorrenciasView onMudou={recarregar} />}
            {abaAtiva === 'extratos' && <ExtratosView onMudou={recarregar} />}
            {abaAtiva === 'contas' && <ContasView onMudou={recarregar} />}
            {abaAtiva === 'chaves' && <ChavesView />}
            {abaAtiva === 'log' && <LogView />}
          </main>
        )}
      </div>
    </div>
  );
}

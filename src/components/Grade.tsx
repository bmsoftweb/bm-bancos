import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Inbox, Loader2, Menu, Search, X,
} from 'lucide-react';
import { ConsultaGrade, PaginaGrade } from '../services/api';
import { LinhasGrade, ModoLargura, lerConfigLista, salvarConfigLista } from '../utils/configListas';
import { INPUT_CLASS } from '../utils/formStyles';
import { ALTURA_CONTROLE } from './ui';
import { AvisoErro } from './AvisoErro';

/**
 * Grade no padrão das listas do b2b admin (CrudView), usada nas telas de lista.
 *
 * Colunas na ordem física [indicador 30px] [dados…] [sobra] [Ações fixa]:
 * redimensionar pela divisa do cabeçalho, arrastar para reordenar, ordenar no
 * clique, menu de 3 traços com Ajustar/Melhor largura e linhas da grade, e as
 * preferências gravadas por usuário só em "Salvar Configuração".
 *
 * Paginação, busca e ordenação acontecem no servidor. Recarregar não troca as
 * linhas por spinner: elas ficam esmaecidas até chegar a página nova.
 */

export interface ColunaGrade<T> {
  /** Identificador estável: é por ele que largura, ordem e ordenação são guardadas */
  nome: string;
  rotulo: string;
  /** numero -> à direita; data e centro -> centralizado; texto (padrão) -> à esquerda */
  tipo?: 'texto' | 'numero' | 'data' | 'centro';
  /** Largura inicial (classe Tailwind), enquanto o usuário não ajusta */
  larguraInicial?: string;
  ordenavel?: boolean;
  valor: (linha: T) => React.ReactNode;
  /** Texto do tooltip, útil quando o valor é truncado */
  dica?: (linha: T) => string | undefined;
}

interface GradeProps<T> {
  /** Chave das preferências em sys_usuarios.config_listas */
  recurso: string;
  colunas: ColunaGrade<T>[];
  carregarPagina: (consulta: ConsultaGrade) => Promise<PaginaGrade<T>>;
  chave: (linha: T) => string | number;
  ordemPadrao: { campo: string; direcao: 'asc' | 'desc' };
  /** Botões de cada linha, na coluna Ações fixa à direita (ícones com title) */
  acoes?: (linha: T) => React.ReactNode;
  /** Largura da coluna Ações em px; o padrão do b2b é 96 (w-24) */
  larguraAcoes?: number;
  /** Botões da barra de ferramentas, depois da busca e do "N por página" */
  botoes?: React.ReactNode;
  selecionada?: T | null;
  onSelecionar?: (linha: T | null) => void;
  onDuploClique?: (linha: T) => void;
  /** Incrementar para recarregar a página atual (depois de uma ação, por exemplo) */
  recarregar?: number;
  rotuloVazio: string;
  onTotal?: (total: number) => void;
}

const ALINHAMENTO: Record<string, string> = {
  texto: 'text-left',
  numero: 'text-right',
  data: 'text-center',
  centro: 'text-center',
};

const BOTAO_PAGINA =
  'p-1.5 rounded-lg border border-stone-300 dark:border-stone-700 text-stone-600 dark:text-stone-300 ' +
  'hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors';

const ITEM_MENU =
  'w-full px-3 py-2 text-xs hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer text-left';

export function Grade<T>({
  recurso,
  colunas: colunasDef,
  carregarPagina,
  chave,
  ordemPadrao,
  acoes,
  larguraAcoes = 96,
  botoes,
  selecionada,
  onSelecionar,
  onDuploClique,
  recarregar = 0,
  rotuloVazio,
  onTotal,
}: GradeProps<T>) {
  // ------------------------------------------------------------------
  // Dados
  // ------------------------------------------------------------------
  const [linhas, setLinhas] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPaginas, setTotalPaginas] = useState(1);
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(25);
  const [busca, setBusca] = useState('');
  const [buscaDigitada, setBuscaDigitada] = useState('');
  const [ordem, setOrdemCampo] = useState(ordemPadrao.campo);
  const [direcao, setDirecao] = useState<'asc' | 'desc'>(ordemPadrao.direcao);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<{ texto: string; erro?: boolean } | null>(null);

  // ------------------------------------------------------------------
  // Preferências de colunas (config_listas)
  // ------------------------------------------------------------------
  const [ordemColunas, setOrdemColunas] = useState<string[]>([]);
  const [larguras, setLarguras] = useState<Record<string, number>>({});
  const [menuAberto, setMenuAberto] = useState(false);
  const [grade, setGrade] = useState<LinhasGrade>('horizontais');
  const [comSobra, setComSobra] = useState(true);
  const [modoLargura, setModoLargura] = useState<ModoLargura>('manual');
  const arrastando = useRef<string | null>(null);
  const tabelaRef = useRef<HTMLTableElement>(null);

  // Guarda a última seleção sem refazer o load a cada clique
  const selecionadaRef = useRef(selecionada);
  selecionadaRef.current = selecionada;

  const colunas = useMemo(() => {
    if (!ordemColunas.length) return colunasDef;
    const posicao = (nome: string) => {
      const i = ordemColunas.indexOf(nome);
      return i < 0 ? ordemColunas.length : i;
    };
    return [...colunasDef].sort((a, b) => posicao(a.nome) - posicao(b.nome));
  }, [colunasDef, ordemColunas]);

  useEffect(() => {
    let vivo = true;
    lerConfigLista(recurso).then((cfg) => {
      if (!vivo) return;
      setLarguras(cfg.larguras || {});
      setOrdemColunas(cfg.ordem || []);
      setGrade(cfg.grade || 'horizontais');
      setComSobra(cfg.sobra !== false);
      setModoLargura(cfg.modo || 'manual');
    });
    return () => {
      vivo = false;
    };
  }, [recurso]);

  // A borda existe sempre (só fica transparente): senão a altura da linha muda com a grade
  const bordasCelula = `border-b border-r ${
    grade === 'ambas' || grade === 'horizontais' ? 'border-b-stone-100 dark:border-b-stone-800/60' : 'border-b-transparent'
  } ${grade === 'ambas' || grade === 'verticais' ? 'border-r-stone-100 dark:border-r-stone-800/60' : 'border-r-transparent'}`;

  // ------------------------------------------------------------------
  // Carga
  // ------------------------------------------------------------------
  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const resposta = await carregarPagina({ pagina, porPagina, busca, ordem, direcao });
      setLinhas(resposta.data);
      setTotal(resposta.total);
      setTotalPaginas(resposta.totalPages);
      onTotal?.(resposta.total);

      // A linha selecionada é substituída pela versão nova (a situação pode ter mudado)
      const atual = selecionadaRef.current;
      if (atual && onSelecionar) {
        const nova = resposta.data.find((l) => chave(l) === chave(atual));
        onSelecionar(nova ?? null);
      }
    } catch (err: any) {
      setErro(err.message || 'Falha ao carregar os registros.');
      setLinhas([]);
    } finally {
      setCarregando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagina, porPagina, busca, ordem, direcao, carregarPagina]);

  useEffect(() => {
    carregar();
  }, [carregar, recarregar]);

  // A seleção do mestre-detalhe não sobrevive a troca de página ou de busca
  useEffect(() => {
    onSelecionar?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagina, busca]);

  const ordenar = (campo: string) => {
    if (ordem === campo) setDirecao((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setOrdemCampo(campo);
      setDirecao('asc');
    }
    setPagina(1);
  };

  const pesquisar = (e: React.FormEvent) => {
    e.preventDefault();
    setBusca(buscaDigitada.trim());
    setPagina(1);
  };

  // ------------------------------------------------------------------
  // Larguras
  // ------------------------------------------------------------------

  /** Largura de cada coluna só pelo conteúdo: [indicador, ...colunas, ..., ações] */
  const medirColunas = (): number[] | null => {
    const tabela = tabelaRef.current;
    if (!tabela) return null;
    const cabecalhos = Array.from(tabela.querySelectorAll('thead th')) as HTMLElement[];
    const celulas = Array.from(tabela.querySelectorAll('tbody tr:first-child > td')) as HTMLElement[];
    const anteriores = [...cabecalhos, ...celulas].map((c) => c.style.width);
    [...cabecalhos, ...celulas].forEach((c) => {
      c.style.width = '';
      c.style.maxWidth = '';
    });
    const larguraTabela = tabela.style.width;
    tabela.style.width = 'max-content';
    const medidas = cabecalhos.map((th) => th.offsetWidth);
    tabela.style.width = larguraTabela;
    [...cabecalhos, ...celulas].forEach((c, i) => {
      c.style.width = anteriores[i];
    });
    return medidas;
  };

  const aplicarMelhorLargura = () => {
    setComSobra(true);
    const medidas = medirColunas();
    if (!medidas) return;
    setLarguras(Object.fromEntries(colunas.map((c, i) => [c.nome, Math.max(60, medidas[i + 1])])));
  };

  /** Reparte todo o espaço entre as colunas, na proporção do que cada uma ocupa hoje */
  const aplicarAjustarLargura = () => {
    setComSobra(false);
    const tabela = tabelaRef.current;
    const area = tabela?.parentElement;
    if (!tabela || !area) return;
    const cabecalhos = Array.from(tabela.querySelectorAll('thead th')) as HTMLElement[];
    const atuais = cabecalhos.slice(1, 1 + colunas.length).map((th) => th.offsetWidth);
    const soma = atuais.reduce((a, b) => a + b, 0);
    const fixas = cabecalhos[0].offsetWidth + cabecalhos[cabecalhos.length - 1].offsetWidth;
    const disponivel = area.clientWidth - fixas - 1;
    if (soma <= 0 || disponivel <= 0) return;
    const fator = disponivel / soma;
    const finais = atuais.map((l) => Math.max(50, Math.floor(l * fator)));
    const resto = disponivel - finais.reduce((a, b) => a + b, 0);
    if (resto > 0) finais[finais.length - 1] += resto;
    setLarguras(Object.fromEntries(colunas.map((c, i) => [c.nome, finais[i]])));
  };

  // Nos modos automáticos a largura é recalculada ao abrir, quando chegam as linhas
  // e quando a janela muda de tamanho (outro monitor, por exemplo)
  useEffect(() => {
    if (modoLargura === 'manual') return;
    const aplicar = () => (modoLargura === 'ajustar' ? aplicarAjustarLargura() : aplicarMelhorLargura());
    const id = requestAnimationFrame(aplicar);
    window.addEventListener('resize', aplicar);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener('resize', aplicar);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modoLargura, colunas, linhas]);

  const iniciarRedimensionamento = (e: React.PointerEvent, nome: string) => {
    e.preventDefault();
    e.stopPropagation();
    setModoLargura('manual');

    const tabela = tabelaRef.current;
    if (!tabela) return;
    const cabecalhos = Array.from(tabela.querySelectorAll('thead th')) as HTMLElement[];
    // Congela as larguras atuais: sem isso o navegador redistribui a sobra e o arraste escorrega
    const base = cabecalhos.slice(1, 1 + colunas.length).map((th) => th.offsetWidth);
    const indice = colunas.findIndex((c) => c.nome === nome);
    const xInicial = e.clientX;

    const mover = (ev: PointerEvent) => {
      const finais = [...base];
      finais[indice] = Math.max(50, base[indice] + ev.clientX - xInicial);
      // Sem coluna de sobra, quem cede espaço é a coluna seguinte, para o total não mudar
      if (!comSobra && indice < finais.length - 1) {
        finais[indice + 1] = Math.max(50, base[indice + 1] - (finais[indice] - base[indice]));
      }
      setLarguras(Object.fromEntries(colunas.map((c, i) => [c.nome, finais[i]])));
    };

    const soltar = () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
  };

  const soltarColuna = (destino: string) => {
    const origem = arrastando.current;
    arrastando.current = null;
    if (!origem || origem === destino) return;
    const nomes = colunas.map((c) => c.nome).filter((n) => n !== origem);
    nomes.splice(nomes.indexOf(destino), 0, origem);
    setOrdemColunas(nomes);
  };

  const salvarConfiguracao = async () => {
    setMenuAberto(false);
    try {
      await salvarConfigLista(recurso, {
        // Nos modos automáticos a largura depende da tela; só a manual é guardada
        larguras: modoLargura === 'manual' ? larguras : undefined,
        ordem: ordemColunas,
        grade,
        sobra: comSobra,
        modo: modoLargura,
      });
      setMensagem({ texto: 'Configuração salva.' });
    } catch (err: any) {
      setMensagem({ texto: err.message || 'Não foi possível salvar a configuração.', erro: true });
    }
    setTimeout(() => setMensagem(null), 5000);
  };

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  const primeiro = (pagina - 1) * porPagina + 1;
  const ultimo = Math.min(pagina * porPagina, total);
  const estiloAcoes = { width: larguraAcoes, minWidth: larguraAcoes, maxWidth: larguraAcoes };

  /**
   * Com a tabela presa em 100%, alargar uma coluna quando não há mais sobra não tem
   * efeito: o navegador espreme todas de volta para caber. Com a largura mínima igual
   * à soma das colunas, a tabela passa da tela e rola na horizontal — com o indicador
   * e as Ações continuando fixos nas bordas. Com espaço sobrando, nada muda.
   */
  const larguraMinima = useMemo(() => {
    const definidas = colunas.reduce((soma, c) => soma + (larguras[c.nome] || 0), 0);
    return definidas ? definidas + 30 + (acoes ? larguraAcoes : 0) : undefined;
  }, [colunas, larguras, acoes, larguraAcoes]);

  /**
   * A coluna de sobra tem largura de 100%. Com espaço livre ela só fica com o resto,
   * mas quando as colunas já passam da área o navegador dá prioridade a ela e reduz
   * as outras ao mínimo do conteúdo — e alargar uma coluna deixa de ter efeito. Por
   * isso ela só aparece enquanto couber.
   */
  const [larguraArea, setLarguraArea] = useState(0);
  useEffect(() => {
    const area = tabelaRef.current?.parentElement;
    if (!area) return;
    const medir = () => setLarguraArea(area.clientWidth);
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(area);
    return () => observador.disconnect();
  }, []);
  const mostrarSobra = comSobra && !(larguraMinima && larguraArea && larguraMinima >= larguraArea);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-stone-900">
      {/* Barra de ferramentas numa linha só: resumo, busca, por página e botões da tela */}
      <div className="px-4 py-2.5 border-b border-stone-200 dark:border-stone-800 flex items-center justify-between gap-3 shrink-0 overflow-x-auto overflow-y-hidden">
        <div
          className={`text-[11px] truncate min-w-0 ${
            mensagem?.erro ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-stone-500 dark:text-stone-400'
          }`}
        >
          {mensagem
            ? mensagem.texto
            : carregando && !linhas.length
            ? 'Carregando registros…'
            : total === 0
            ? 'Nenhum registro encontrado'
            : `${primeiro}–${ultimo} de ${total} registro(s)`}
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <form onSubmit={pesquisar} className="relative w-52 sm:w-64 shrink-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none" />
            <input
              type="text"
              value={buscaDigitada}
              onChange={(e) => setBuscaDigitada(e.target.value)}
              placeholder="Buscar…"
              className={`${INPUT_CLASS} ${ALTURA_CONTROLE} w-full pl-9 pr-8`}
            />
            {buscaDigitada && (
              <button
                type="button"
                onClick={() => {
                  setBuscaDigitada('');
                  setBusca('');
                  setPagina(1);
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 cursor-pointer"
                title="Limpar a busca"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </form>

          <select
            value={porPagina}
            onChange={(e) => {
              setPorPagina(Number(e.target.value));
              setPagina(1);
            }}
            title="Registros por página"
            className={`${INPUT_CLASS} ${ALTURA_CONTROLE} shrink-0 cursor-pointer`}
          >
            {[10, 25, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n} por página
              </option>
            ))}
          </select>

          {botoes}
        </div>
      </div>

      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}

      {/* Grade ocupando a altura restante */}
      <div className="flex-1 overflow-auto min-h-[220px]">
        <table
          ref={tabelaRef}
          style={larguraMinima ? { minWidth: larguraMinima } : undefined}
          className="w-full text-xs border-separate border-spacing-0"
        >
          <thead className="sticky top-0 z-10">
            <tr className="bg-stone-50 dark:bg-stone-950/90 backdrop-blur-xs">
              <th className="sticky left-0 z-20 w-[30px] min-w-[30px] max-w-[30px] px-0 text-center border-b border-r border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950">
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setMenuAberto((v) => !v)}
                    title="Opções das colunas"
                    className="p-1 mx-auto block text-stone-400 hover:text-blue-600 dark:text-stone-500 dark:hover:text-blue-400 cursor-pointer"
                  >
                    <Menu className="w-3.5 h-3.5" />
                  </button>
                  {menuAberto && (
                    <>
                      <div className="fixed inset-0 z-30" onClick={() => setMenuAberto(false)} />
                      <div className="absolute left-0 top-full z-40 mt-1 w-52 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 shadow-lg py-1 text-left font-normal">
                        <button
                          type="button"
                          onClick={() => {
                            setMenuAberto(false);
                            setModoLargura('ajustar');
                            aplicarAjustarLargura();
                          }}
                          className={`${ITEM_MENU} ${modoLargura === 'ajustar' ? 'text-blue-700 dark:text-blue-300 font-semibold' : 'text-stone-700 dark:text-stone-200'}`}
                        >
                          Ajustar largura
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setMenuAberto(false);
                            setModoLargura('melhor');
                            aplicarMelhorLargura();
                          }}
                          className={`${ITEM_MENU} ${modoLargura === 'melhor' ? 'text-blue-700 dark:text-blue-300 font-semibold' : 'text-stone-700 dark:text-stone-200'}`}
                        >
                          Melhor largura
                        </button>
                        <div className="my-1 border-t border-stone-200 dark:border-stone-700" />
                        {(
                          [
                            ['ambas', 'Mostrar linhas da grade'],
                            ['horizontais', 'Mostrar linhas horizontais'],
                            ['verticais', 'Mostrar linhas verticais'],
                            ['nenhuma', 'Não mostrar linhas da grade'],
                          ] as [LinhasGrade, string][]
                        ).map(([valor, rotulo]) => (
                          <button
                            key={valor}
                            type="button"
                            onClick={() => {
                              setGrade(valor);
                              setMenuAberto(false);
                            }}
                            className={`${ITEM_MENU} ${
                              grade === valor ? 'text-blue-700 dark:text-blue-300 font-semibold' : 'text-stone-700 dark:text-stone-200'
                            }`}
                          >
                            {rotulo}
                          </button>
                        ))}
                        <div className="my-1 border-t border-stone-200 dark:border-stone-700" />
                        <button type="button" onClick={salvarConfiguracao} className={`${ITEM_MENU} text-stone-700 dark:text-stone-200`}>
                          Salvar Configuração
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </th>

              {colunas.map((c) => {
                const ordenada = ordem === c.nome;
                const ordenavel = c.ordenavel !== false;
                return (
                  <th
                    key={c.nome}
                    draggable
                    onDragStart={(e) => {
                      arrastando.current = c.nome;
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      soltarColuna(c.nome);
                    }}
                    onClick={ordenavel ? () => ordenar(c.nome) : undefined}
                    style={larguras[c.nome] ? { width: larguras[c.nome] } : undefined}
                    className={`relative px-3 py-2.5 text-center font-semibold text-stone-600 dark:text-stone-300 whitespace-nowrap select-none transition-colors border-b border-r border-stone-200 dark:border-stone-800 ${
                      ordenavel ? 'cursor-pointer hover:bg-stone-100 dark:hover:bg-stone-800/60' : ''
                    } ${grade === 'ambas' || grade === 'verticais' ? '' : 'border-r-transparent'} ${
                      larguras[c.nome] ? '' : c.larguraInicial || ''
                    }`}
                    title={ordenavel ? `Ordenar por ${c.rotulo}` : c.rotulo}
                  >
                    <span
                      draggable={false}
                      onDragStart={(e) => e.preventDefault()}
                      onPointerDown={(e) => iniciarRedimensionamento(e, c.nome)}
                      onClick={(e) => e.stopPropagation()}
                      title={`Arrastar para redimensionar ${c.rotulo}`}
                      className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-blue-400/60"
                    />
                    <span className="inline-flex items-center gap-1 justify-center">
                      {c.rotulo}
                      {ordenada &&
                        (direcao === 'asc' ? (
                          <ArrowUp className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                        ) : (
                          <ArrowDown className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                        ))}
                    </span>
                  </th>
                );
              })}

              {/* Coluna de sobra: fica com o espaço livre, para o redimensionar funcionar com poucas colunas */}
              {mostrarSobra && <th className="w-full border-b border-stone-200 dark:border-stone-800" />}

              {acoes && (
                <th
                  style={estiloAcoes}
                  className="sticky right-0 z-20 px-3 py-2.5 text-center font-semibold text-stone-600 dark:text-stone-300 border-b border-l border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950"
                >
                  Ações
                </th>
              )}
            </tr>
          </thead>

          <tbody className={carregando && linhas.length > 0 ? 'opacity-60' : undefined}>
            {carregando && linhas.length === 0 && (
              <tr>
                <td colSpan={colunas.length + 3} className="px-3 py-12 text-center">
                  <div className="flex items-center justify-center gap-2 text-stone-500 dark:text-stone-400">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Carregando registros…</span>
                  </div>
                </td>
              </tr>
            )}

            {!carregando && linhas.length === 0 && (
              <tr>
                <td colSpan={colunas.length + 3} className="px-3 py-16 text-center">
                  <div className="flex flex-col items-center gap-2 text-stone-400">
                    <Inbox className="w-8 h-8" />
                    <span className="text-sm font-medium text-stone-600 dark:text-stone-300">
                      {busca ? 'Nenhum registro corresponde à busca' : rotuloVazio}
                    </span>
                  </div>
                </td>
              </tr>
            )}

            {linhas.map((linha) => {
              const id = chave(linha);
              const estaSelecionada = selecionada != null && chave(selecionada) === id;
              return (
                <tr
                  key={id}
                  onClick={onSelecionar ? () => onSelecionar(linha) : undefined}
                  onDoubleClick={onDuploClique ? () => onDuploClique(linha) : undefined}
                  className={`group transition-colors ${onSelecionar ? 'cursor-pointer' : ''} ${
                    estaSelecionada
                      ? 'bg-blue-100 dark:bg-blue-950'
                      : 'bg-white dark:bg-stone-900 hover:bg-stone-50 dark:hover:bg-stone-800'
                  }`}
                >
                  <td className={`sticky left-0 z-[5] w-[30px] min-w-[30px] max-w-[30px] px-0 text-center align-middle bg-inherit border-r border-stone-200 dark:border-stone-800 ${bordasCelula}`}>
                    <ChevronRight
                      className={`w-3.5 h-3.5 mx-auto ${
                        estaSelecionada
                          ? 'text-blue-600 dark:text-blue-400'
                          : 'text-stone-300 opacity-0 group-hover:opacity-100 dark:text-stone-600'
                      }`}
                    />
                  </td>
                  {colunas.map((c) => (
                    <td
                      key={c.nome}
                      title={c.dica?.(linha)}
                      style={larguras[c.nome] ? { width: larguras[c.nome], maxWidth: larguras[c.nome] } : undefined}
                      className={`px-3 py-[7.5px] text-stone-700 dark:text-stone-300 align-middle max-w-xs truncate ${bordasCelula} ${
                        ALINHAMENTO[c.tipo || 'texto']
                      }`}
                    >
                      {c.valor(linha)}
                    </td>
                  ))}
                  {mostrarSobra && <td className={`w-full ${bordasCelula}`} />}
                  {acoes && (
                    <td
                      style={estiloAcoes}
                      className={`sticky right-0 z-[5] px-2 py-[7.5px] text-center whitespace-nowrap bg-inherit border-l border-stone-200 dark:border-stone-800 ${bordasCelula}`}
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => e.stopPropagation()}
                    >
                      <div className="inline-flex items-center gap-1">{acoes(linha)}</div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Paginação fixa ao pé */}
      {totalPaginas > 1 && (
        <div className="px-4 py-2.5 border-t border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950/40 flex items-center justify-between gap-3 shrink-0">
          <span className="text-[11px] text-stone-500 dark:text-stone-400">
            Página {pagina} de {totalPaginas} ({total.toLocaleString('pt-BR')} {total === 1 ? 'registro' : 'registros'})
          </span>
          <div className="flex items-center gap-1.5">
            {/* Primeira, anterior, próxima e última página (como no crmWeb) */}
            {(
              [
                [ChevronsLeft, 'Primeira página', 1, pagina <= 1],
                [ChevronLeft, 'Página anterior', Math.max(1, pagina - 1), pagina <= 1],
                [ChevronRight, 'Próxima página', Math.min(totalPaginas, pagina + 1), pagina >= totalPaginas],
                [ChevronsRight, 'Última página', totalPaginas, pagina >= totalPaginas],
              ] as const
            ).map(([Icone, titulo, destino, desabilitado]) => (
              <button key={titulo} type="button" onClick={() => setPagina(destino)} disabled={desabilitado} className={BOTAO_PAGINA} title={titulo}>
                <Icone className="w-4 h-4" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Botão de ícone da coluna Ações, no formato do b2b (p-1, cinza, cor no hover) */
export const AcaoGrade: React.FC<{
  titulo: string;
  onClick: () => void;
  icone: React.ReactNode;
  tom?: 'azul' | 'vermelho' | 'verde';
  desabilitado?: boolean;
}> = ({ titulo, onClick, icone, tom = 'azul', desabilitado }) => {
  const hover: Record<string, string> = {
    azul: 'hover:text-blue-600 hover:bg-blue-50 dark:hover:text-blue-400 dark:hover:bg-blue-950/40',
    vermelho: 'hover:text-rose-600 hover:bg-rose-50 dark:hover:text-rose-400 dark:hover:bg-rose-950/40',
    verde: 'hover:text-emerald-600 hover:bg-emerald-50 dark:hover:text-emerald-400 dark:hover:bg-emerald-950/40',
  };
  return (
    <button
      type="button"
      title={titulo}
      disabled={desabilitado}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`p-1 rounded text-stone-400 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${hover[tom]}`}
    >
      {icone}
    </button>
  );
};

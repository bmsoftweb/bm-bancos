import React, { useEffect } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { FIELD_CLASS, HINT_CLASS, INPUT_CLASS, LABEL_CLASS } from '../utils/formStyles';

/** Altura comum a campos e botões, para que fiquem alinhados lado a lado */
export const ALTURA_CONTROLE = 'h-[34px]';

// ---------------------------------------------------------------------------
// Campos
// ---------------------------------------------------------------------------

interface CampoProps {
  rotulo: string;
  children: React.ReactNode;
  dica?: string;
  className?: string;
}

export const Campo: React.FC<CampoProps> = ({ rotulo, children, dica, className = '' }) => (
  <div className={`${FIELD_CLASS} ${className}`}>
    <label className={LABEL_CLASS}>{rotulo}</label>
    {children}
    {dica && <span className={HINT_CLASS}>{dica}</span>}
  </div>
);

/*
 * Com rótulo, o className vai para o bloco rótulo + campo, que é quem ocupa a
 * célula da grade (lg:col-span-*, flex-1, w-24...). No <input> ele não tinha
 * efeito nenhum e todo campo ficava com uma coluna só.
 *
 * Por isso o className é só de layout. Fonte não se muda por ali — o rótulo
 * herdaria junto. E nem é para mudar: todo campo tem a mesma família, o mesmo
 * tamanho e o mesmo peso, sem destaque para data, número ou código.
 */

type TextoProps = React.InputHTMLAttributes<HTMLInputElement> & { rotulo?: string; dica?: string };

export const Texto: React.FC<TextoProps> = ({ rotulo, dica, className = '', ...props }) => {
  const estilo = `${INPUT_CLASS} ${ALTURA_CONTROLE} w-full`;
  if (!rotulo) {
    return <input {...props} className={`${estilo} ${className}`} />;
  }
  return (
    <Campo rotulo={rotulo} dica={dica} className={className}>
      <input {...props} className={estilo} />
    </Campo>
  );
};

type AreaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & { rotulo?: string; dica?: string };

export const Area: React.FC<AreaProps> = ({ rotulo, dica, className = '', ...props }) => {
  // Textarea é a exceção da regra de selecionar tudo ao focar
  if (!rotulo) {
    return <textarea {...props} className={`${INPUT_CLASS} w-full resize-y ${className}`} />;
  }
  return (
    <Campo rotulo={rotulo} dica={dica} className={className}>
      <textarea {...props} className={`${INPUT_CLASS} w-full resize-y`} />
    </Campo>
  );
};

type SelecaoProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  rotulo?: string;
  dica?: string;
  opcoes: { valor: string | number; rotulo: string }[];
};

export const Selecao: React.FC<SelecaoProps> = ({ rotulo, dica, opcoes, className = '', ...props }) => {
  const opcoesRenderizadas = opcoes.map((o) => (
    <option key={String(o.valor)} value={o.valor}>
      {o.rotulo}
    </option>
  ));

  if (!rotulo) {
    return (
      <select {...props} className={`${INPUT_CLASS} ${ALTURA_CONTROLE} w-full cursor-pointer ${className}`}>
        {opcoesRenderizadas}
      </select>
    );
  }
  return (
    <Campo rotulo={rotulo} dica={dica} className={className}>
      <select {...props} className={`${INPUT_CLASS} ${ALTURA_CONTROLE} w-full cursor-pointer`}>
        {opcoesRenderizadas}
      </select>
    </Campo>
  );
};

// ---------------------------------------------------------------------------
// Botões
// ---------------------------------------------------------------------------

interface BotaoProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: 'primario' | 'neutro' | 'perigo' | 'sucesso';
  icone?: React.ReactNode;
  carregando?: boolean;
}

const VARIANTES: Record<string, string> = {
  primario: 'bg-blue-600 hover:bg-blue-700 text-white border-blue-600',
  neutro:
    'bg-white hover:bg-stone-100 text-stone-700 border-stone-300 dark:bg-stone-800 dark:hover:bg-stone-700 dark:text-stone-200 dark:border-stone-700',
  perigo: 'bg-red-600 hover:bg-red-700 text-white border-red-600',
  sucesso: 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600',
};

export const Botao: React.FC<BotaoProps> = ({
  variante = 'neutro',
  icone,
  carregando,
  children,
  className = '',
  disabled,
  ...props
}) => (
  <button
    type="button"
    {...props}
    disabled={disabled || carregando}
    className={`${ALTURA_CONTROLE} inline-flex items-center justify-center gap-2 px-3 border rounded-lg
      text-xs font-semibold transition-colors cursor-pointer shrink-0
      disabled:opacity-50 disabled:cursor-not-allowed ${VARIANTES[variante]} ${className}`}
  >
    {carregando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : icone}
    {children}
  </button>
);

// ---------------------------------------------------------------------------
// Blocos de tela
// ---------------------------------------------------------------------------

/**
 * Bloco de conteúdo de uma tela.
 *
 * `chapado` (padrão) segue as telas do b2b admin: sem caixa, sem canto arredondado e
 * sem sombra — o bloco encosta nas bordas da área útil e se separa do próximo por uma
 * linha, com o título num rótulo pequeno em maiúsculas, como os grupos do RecordForm.
 * `cartao` é o visual de cartão, reservado ao painel.
 */
export const Secao: React.FC<{
  titulo: string;
  descricao?: string;
  children: React.ReactNode;
  acoes?: React.ReactNode;
  variante?: 'chapado' | 'cartao';
}> = ({ titulo, descricao, children, acoes, variante = 'chapado' }) => {
  if (variante === 'cartao') {
    return (
      <section className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl overflow-hidden">
        <header className="px-4 py-3 border-b border-stone-200 dark:border-stone-800 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-bold text-stone-800 dark:text-stone-100">{titulo}</h2>
            {descricao && <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-0.5">{descricao}</p>}
          </div>
          {acoes && <div className="flex items-center gap-2 flex-wrap">{acoes}</div>}
        </header>
        <div className="p-4">{children}</div>
      </section>
    );
  }

  return (
    <section className="bg-white dark:bg-stone-900 border-b border-stone-200 dark:border-stone-800">
      <header className="px-4 pt-3 pb-2 flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">{titulo}</h2>
          {descricao && <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-0.5">{descricao}</p>}
        </div>
        {acoes && <div className="flex items-center gap-2 flex-wrap">{acoes}</div>}
      </header>
      <div className="px-4 pb-4">{children}</div>
    </section>
  );
};

/** Faixa de abas das telas do b2b admin: quadrada, com a aba ativa branca e traço azul */
export const Abas: React.FC<{
  abas: { id: string; rotulo: string; icone?: React.ReactNode }[];
  ativa: string;
  onTrocar: (id: string) => void;
}> = ({ abas, ativa, onTrocar }) => (
  <div className="flex items-stretch bg-stone-100 dark:bg-stone-950 border-b border-stone-200 dark:border-stone-800 overflow-x-auto overflow-y-hidden shrink-0">
    {abas.map((aba) => (
      <button
        key={aba.id}
        type="button"
        onClick={() => onTrocar(aba.id)}
        className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold whitespace-nowrap border-r border-stone-200 dark:border-stone-800 border-b-2 transition-colors cursor-pointer ${
          ativa === aba.id
            ? 'bg-white dark:bg-stone-900 text-blue-700 dark:text-blue-400 border-b-blue-600'
            : 'border-b-transparent text-stone-600 dark:text-stone-400 hover:bg-stone-200/60 dark:hover:bg-stone-800/60'
        }`}
      >
        {aba.icone}
        {aba.rotulo}
      </button>
    ))}
  </div>
);

/** Aviso em faixa de largura total, chapado como o resto da tela */
export const Faixa: React.FC<{
  tom: 'info' | 'sucesso' | 'erro' | 'alerta';
  children: React.ReactNode;
  onFechar?: () => void;
}> = ({ tom, children, onFechar }) => {
  const cores: Record<string, string> = {
    info: 'bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-900',
    sucesso: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900',
    erro: 'bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300 border-red-200 dark:border-red-900',
    alerta: 'bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 border-amber-200 dark:border-amber-900',
  };
  return (
    <div className={`text-xs px-4 py-2.5 border-b flex items-start justify-between gap-3 ${cores[tom]}`}>
      <div className="min-w-0 flex-1">{children}</div>
      {onFechar && (
        <button type="button" className="font-bold cursor-pointer shrink-0" onClick={onFechar} aria-label="Fechar aviso">
          ×
        </button>
      )}
    </div>
  );
};

/** Diálogo de confirmação do projeto — substitui o window.confirm */
export const Confirmacao: React.FC<{
  aberto: boolean;
  titulo: string;
  mensagem: React.ReactNode;
  rotuloConfirmar?: string;
  perigo?: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}> = ({ aberto, titulo, mensagem, rotuloConfirmar = 'Confirmar', perigo = true, onConfirmar, onCancelar }) => {
  useEffect(() => {
    if (!aberto) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancelar();
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [aberto, onCancelar]);

  if (!aberto) return null;

  return (
    <div className="fixed inset-0 z-50 bg-stone-900/50 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="px-5 py-4 flex items-start gap-3">
          <div className={`p-2 rounded-xl ${perigo ? 'bg-red-50 dark:bg-red-950/40' : 'bg-blue-50 dark:bg-blue-950/40'}`}>
            <AlertTriangle className={`w-5 h-5 ${perigo ? 'text-red-600' : 'text-blue-600'}`} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-stone-800 dark:text-stone-100">{titulo}</h3>
            <div className="text-xs text-stone-600 dark:text-stone-300 mt-1.5">{mensagem}</div>
          </div>
          <button type="button" onClick={onCancelar} className="text-stone-400 hover:text-stone-700 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-3 border-t border-stone-200 dark:border-stone-800 flex justify-end gap-2">
          <Botao onClick={onCancelar}>Cancelar</Botao>
          <Botao variante={perigo ? 'perigo' : 'primario'} onClick={onConfirmar}>
            {rotuloConfirmar}
          </Botao>
        </div>
      </div>
    </div>
  );
};

export const Vazio: React.FC<{ mensagem: string; icone?: React.ReactNode }> = ({ mensagem, icone }) => (
  <div className="py-12 text-center text-xs text-stone-500 dark:text-stone-400 flex flex-col items-center gap-2">
    {icone}
    <span>{mensagem}</span>
  </div>
);

export const Etiqueta: React.FC<{ texto: string; classe: string }> = ({ texto, classe }) => (
  <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${classe}`}>
    {texto}
  </span>
);

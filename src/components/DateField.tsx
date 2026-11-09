import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { INPUT_CLASS } from '../utils/formStyles';
import { ALTURA_CONTROLE } from './ui';

/**
 * O visual padrão vem daqui, não de quem usa: antes o campo dependia de receber o
 * className de fora e, sem ele, saía com a fonte do navegador (maior) e em mono. Agora é igual aos demais campos.
 */
const ESTILO_CAMPO = `${INPUT_CLASS} ${ALTURA_CONTROLE} w-full`;

interface DateFieldProps {
  id?: string;
  /** Valor em ISO: "aaaa-mm-dd" ou "aaaa-mm-ddThh:mm" quando withTime */
  value: string;
  onChange: (isoValue: string) => void;
  required?: boolean;
  /** Acrescenta o campo de hora ao lado, para colunas datetime */
  withTime?: boolean;
  className?: string;
  placeholder?: string;
}

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];
const DIAS_SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

/** "aaaa-mm-dd" -> "dd/mm/aaaa" */
function isoParaBr(iso: string): string {
  if (!iso) return '';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return a && m && d ? `${d}/${m}/${a}` : '';
}

/** "dd/mm/aaaa" -> "aaaa-mm-dd" (vazio quando a data não existe no calendário) */
function brParaIso(br: string): string {
  const digitos = br.replace(/\D/g, '');
  if (digitos.length !== 8) return '';
  const d = Number(digitos.slice(0, 2));
  const m = Number(digitos.slice(2, 4));
  const a = Number(digitos.slice(4, 8));
  if (m < 1 || m > 12 || d < 1) return '';
  // Rejeita 31/02 e afins comparando com a data que o JS realmente montou
  const data = new Date(a, m - 1, d);
  if (data.getFullYear() !== a || data.getMonth() !== m - 1 || data.getDate() !== d) return '';
  return `${String(a).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Máscara dd/mm/aaaa conforme o operador digita */
function mascaraData(texto: string): string {
  const n = texto.replace(/\D/g, '').slice(0, 8);
  if (n.length > 4) return `${n.slice(0, 2)}/${n.slice(2, 4)}/${n.slice(4)}`;
  if (n.length > 2) return `${n.slice(0, 2)}/${n.slice(2)}`;
  return n;
}

function isoDeHoje(): string {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-${String(h.getDate()).padStart(2, '0')}`;
}

/**
 * Campo de data com calendário próprio, no lugar do seletor nativo do navegador.
 * Digita-se no formato brasileiro (dd/mm/aaaa) e o valor sai sempre em ISO,
 * que é o formato aceito pelo MySQL.
 */
export const DateField: React.FC<DateFieldProps> = ({
  id,
  value,
  onChange,
  required,
  withTime,
  className = '',
  placeholder = 'dd/mm/aaaa',
}) => {
  const isoData = (value || '').slice(0, 10);
  const hora = withTime ? (value || '').slice(11, 16) : '';

  const [texto, setTexto] = useState(() => isoParaBr(isoData));
  const [aberto, setAberto] = useState(false);
  const [mesVisivel, setMesVisivel] = useState(() => {
    const base = isoData || isoDeHoje();
    const [a, m] = base.split('-').map(Number);
    return { ano: a, mes: m - 1 };
  });

  const ancoraRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  // Mantém o texto sincronizado quando o valor muda por fora (troca de registro)
  useEffect(() => {
    setTexto(isoParaBr(isoData));
  }, [isoData]);

  /** Junta data e hora no formato que o campo devolve */
  const emitir = (novoIso: string, novaHora?: string) => {
    if (!novoIso) {
      onChange('');
      return;
    }
    if (withTime) {
      const h = (novaHora ?? hora) || '00:00';
      onChange(`${novoIso}T${h}`);
    } else {
      onChange(novoIso);
    }
  };

  // Posiciona o calendário; usa portal para não ser cortado por áreas roláveis
  useEffect(() => {
    if (!aberto) return;

    const reposicionar = () => {
      const r = ancoraRef.current?.getBoundingClientRect();
      if (!r) return;
      const ALTURA = 340;
      const LARGURA = 280;
      const cabeAbaixo = window.innerHeight - r.bottom > ALTURA;
      setPos({
        top: cabeAbaixo ? r.bottom + 4 : Math.max(8, r.top - ALTURA - 4),
        left: Math.max(8, Math.min(r.left, window.innerWidth - LARGURA - 8)),
      });
    };

    reposicionar();
    window.addEventListener('scroll', reposicionar, true);
    window.addEventListener('resize', reposicionar);
    return () => {
      window.removeEventListener('scroll', reposicionar, true);
      window.removeEventListener('resize', reposicionar);
    };
  }, [aberto]);

  // Fecha ao clicar fora ou com Esc
  useEffect(() => {
    if (!aberto) return;

    const aoClicar = (e: MouseEvent) => {
      const alvo = e.target as Node;
      if (popoverRef.current?.contains(alvo) || ancoraRef.current?.contains(alvo)) return;
      setAberto(false);
    };
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAberto(false);
    };

    document.addEventListener('mousedown', aoClicar);
    document.addEventListener('keydown', aoTeclar);
    return () => {
      document.removeEventListener('mousedown', aoClicar);
      document.removeEventListener('keydown', aoTeclar);
    };
  }, [aberto]);

  const handleTexto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = mascaraData(e.target.value);
    setTexto(t);
    const iso = brParaIso(t);
    if (iso) {
      emitir(iso);
      const [a, m] = iso.split('-').map(Number);
      setMesVisivel({ ano: a, mes: m - 1 });
    } else if (t === '') {
      emitir('');
    }
  };

  /** Ao sair do campo, um texto incompleto volta ao último valor válido */
  const handleBlur = () => {
    if (texto === '') return;
    if (!brParaIso(texto)) setTexto(isoParaBr(isoData));
  };

  /** Dias da grade: preenche o início com os dias do mês anterior */
  const grade = useMemo(() => {
    const { ano, mes } = mesVisivel;
    const primeiro = new Date(ano, mes, 1);
    const diasNoMes = new Date(ano, mes + 1, 0).getDate();
    const inicio = primeiro.getDay();

    const celulas: ({ dia: number; iso: string } | null)[] = [];
    for (let i = 0; i < inicio; i++) celulas.push(null);
    for (let d = 1; d <= diasNoMes; d++) {
      celulas.push({
        dia: d,
        iso: `${ano}-${String(mes + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      });
    }
    return celulas;
  }, [mesVisivel]);

  const hojeIso = isoDeHoje();
  const anoAtual = new Date().getFullYear();
  const anos = useMemo(() => {
    const lista: number[] = [];
    for (let a = anoAtual - 100; a <= anoAtual + 10; a++) lista.push(a);
    return lista;
  }, [anoAtual]);

  const mudarMes = (delta: number) => {
    setMesVisivel(({ ano, mes }) => {
      const m = mes + delta;
      if (m < 0) return { ano: ano - 1, mes: 11 };
      if (m > 11) return { ano: ano + 1, mes: 0 };
      return { ano, mes: m };
    });
  };

  const selecionar = (iso: string) => {
    setTexto(isoParaBr(iso));
    emitir(iso);
    setAberto(false);
  };

  const calendario = (
    <div
      ref={popoverRef}
      style={{ top: pos.top, left: pos.left }}
      className="fixed z-[100] w-[280px] bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-xl shadow-2xl p-3 select-none"
    >
      {/* Navegação de mês e ano */}
      <div className="flex items-center justify-between gap-1.5 mb-2">
        <button
          type="button"
          onClick={() => mudarMes(-1)}
          title="Mês anterior"
          className="p-1 rounded-lg text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer shrink-0"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-1 min-w-0">
          <select
            value={mesVisivel.mes}
            onChange={(e) => setMesVisivel((v) => ({ ...v, mes: Number(e.target.value) }))}
            className="bg-stone-50 dark:bg-stone-800 text-xs font-semibold text-stone-700 dark:text-stone-200 px-1.5 py-1 cursor-pointer"
          >
            {MESES.map((m, i) => (
              <option key={m} value={i}>
                {m}
              </option>
            ))}
          </select>
          <select
            value={mesVisivel.ano}
            onChange={(e) => setMesVisivel((v) => ({ ...v, ano: Number(e.target.value) }))}
            className="bg-stone-50 dark:bg-stone-800 text-xs font-semibold text-stone-700 dark:text-stone-200 px-1.5 py-1 cursor-pointer"
          >
            {anos.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={() => mudarMes(1)}
          title="Próximo mês"
          className="p-1 rounded-lg text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer shrink-0"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Cabeçalho dos dias da semana */}
      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {DIAS_SEMANA.map((d, i) => (
          <div
            key={i}
            className="text-[10px] font-bold text-stone-400 text-center py-1 uppercase"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Dias do mês */}
      <div className="grid grid-cols-7 gap-0.5">
        {grade.map((c, i) =>
          c === null ? (
            <div key={`v${i}`} />
          ) : (
            <button
              key={c.iso}
              type="button"
              onClick={() => selecionar(c.iso)}
              className={`h-8 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                c.iso === isoData
                  ? 'bg-blue-600 text-white font-bold'
                  : c.iso === hojeIso
                  ? 'bg-blue-50 text-blue-700 font-bold dark:bg-blue-950/50 dark:text-blue-300'
                  : 'text-stone-700 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800'
              }`}
            >
              {c.dia}
            </button>
          ),
        )}
      </div>

      {/* Atalhos */}
      <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-stone-200 dark:border-stone-800">
        <button
          type="button"
          onClick={() => selecionar(hojeIso)}
          className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
        >
          Hoje
        </button>
        <button
          type="button"
          onClick={() => {
            setTexto('');
            emitir('');
            setAberto(false);
          }}
          className="text-[11px] font-semibold text-stone-500 hover:text-rose-600 dark:hover:text-rose-400 cursor-pointer flex items-center gap-1"
        >
          <X className="w-3 h-3" />
          Limpar
        </button>
      </div>
    </div>
  );

  return (
    <div ref={ancoraRef} className="flex items-center gap-1.5">
      <div className="relative flex-1 min-w-0">
        <input
          id={id}
          type="text"
          inputMode="numeric"
          value={texto}
          onChange={handleTexto}
          onBlur={handleBlur}
          onFocus={() => setAberto(true)}
          required={required}
          placeholder={placeholder}
          maxLength={10}
          className={`${ESTILO_CAMPO} pr-8 ${className}`}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setAberto((a) => !a)}
          title="Abrir calendário"
          className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-stone-400 hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer"
        >
          <CalendarDays className="w-4 h-4" />
        </button>
      </div>

      {withTime && (
        <input
          type="time"
          value={hora}
          onChange={(e) => emitir(isoData || hojeIso, e.target.value)}
          className={`${ESTILO_CAMPO} w-24 shrink-0 ${className}`}
        />
      )}

      {aberto && createPortal(calendario, document.body)}
    </div>
  );
};

import React, { useLayoutEffect, useRef } from 'react';
import {
  paraDigitos,
  paraCanonico,
  paraExibicao,
  aplicarDigitacao,
  aplicarColagem,
} from '../utils/numeroBancario';
import { INPUT_CLASS } from '../utils/formStyles';
import { ALTURA_CONTROLE } from './ui';

/** Visual padrão embutido, como no DateField: igual aos demais campos */
const ESTILO_CAMPO = `${INPUT_CLASS} ${ALTURA_CONTROLE} w-full`;

interface NumberFieldProps {
  id?: string;
  /**
   * Valor canônico, no formato aceito pelo backend: "1467.45", "-12", "1.0000" ou
   * "" (vazio). Números vindos do banco também servem.
   */
  value: string | number | null | undefined;
  onChange: (valorCanonico: string) => void;
  /** Casas decimais: 0 para inteiros, 2 para valores, 4 para fatores */
  scale?: number;
  /** Permite negativo; o sinal alterna ao digitar "-" */
  allowNegative?: boolean;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

/**
 * Campo numérico no padrão dos aplicativos bancários: só se digitam números e o
 * valor é preenchido da direita para a esquerda. Para 1.467,45 digita-se 146745:
 *   1 -> 0,01   14 -> 0,14   146 -> 1,46   1467 -> 14,67   14674 -> 146,74   146745 -> 1.467,45
 * Backspace remove o último dígito e o cursor fica sempre no fim.
 *
 * A leitura é feita pelo onChange (e não por teclas), o que funciona igual nos
 * teclados virtuais de celular.
 */
export const NumberField: React.FC<NumberFieldProps> = ({
  id,
  value,
  onChange,
  scale = 0,
  allowNegative = false,
  required,
  disabled,
  placeholder,
  className = '',
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const moverCursorParaFim = useRef(false);
  const atual = paraDigitos(value, scale);

  // Depois de cada digitação o cursor volta para o fim, onde entra o próximo dígito
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (el && moverCursorParaFim.current && document.activeElement === el) {
      el.setSelectionRange(el.value.length, el.value.length);
    }
    moverCursorParaFim.current = false;
  });

  return (
    <input
      ref={inputRef}
      id={id}
      type="text"
      inputMode={allowNegative ? 'text' : 'numeric'}
      autoComplete="off"
      value={paraExibicao(atual, scale)}
      onChange={(e) => {
        moverCursorParaFim.current = true;
        onChange(paraCanonico(aplicarDigitacao(e.target.value, atual, scale, allowNegative), scale));
      }}
      onPaste={(e) => {
        e.preventDefault();
        const estado = aplicarColagem(e.clipboardData.getData('text'), scale, allowNegative);
        if (!estado) return;
        moverCursorParaFim.current = true;
        onChange(paraCanonico(estado, scale));
      }}
      required={required}
      disabled={disabled}
      placeholder={placeholder ?? paraExibicao({ negativo: false, digitos: '0' }, scale)}
      className={`${ESTILO_CAMPO} text-right ${className}`}
    />
  );
};

import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { normalizeFinancialNumberDraft } from './normalizeFinancialNumberDraft';

type FinancialNumberInputProps<T extends number | null> = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange'
> & {
  value: T;
  emptyValue?: T;
  onValueChange: (value: T) => void;
};

export function FinancialNumberInput<T extends number | null>({
  value,
  emptyValue,
  onValueChange,
  onFocus,
  onBlur,
  ...props
}: FinancialNumberInputProps<T>) {
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(value == null ? '' : String(value));
  }, [value]);

  return (
    <input
      {...props}
      type="text"
      inputMode="decimal"
      value={draft}
      onFocus={(event) => {
        focused.current = true;
        if (event.currentTarget.value === '0') event.currentTarget.select();
        onFocus?.(event);
      }}
      onBlur={(event) => {
        focused.current = false;
        const normalized = normalizeFinancialNumberDraft(event.currentTarget.value);
        setDraft(normalized);
        if (normalized === '') {
          if (emptyValue !== undefined) onValueChange(emptyValue);
        } else {
          onValueChange(Number(normalized) as T);
        }
        onBlur?.(event);
      }}
      onChange={(event) => {
        const next = normalizeFinancialNumberDraft(event.target.value);
        setDraft(next);
        if (next === '') {
          if (emptyValue !== undefined) onValueChange(emptyValue);
        } else {
          const parsed = Number(next);
          if (Number.isFinite(parsed)) onValueChange(parsed as T);
        }
      }}
    />
  );
}
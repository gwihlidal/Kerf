import { useState, type ReactNode } from 'react';
import type { Units } from '../lib/types';
import { formatLength, parseLength } from '../lib/units';

interface DimInputProps {
  value: number;
  units: Units;
  precision: number;
  onChange: (v: number) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
}

/** Length input that accepts fractions, feet/inches and metric suffixes, and displays nicely formatted values. */
export function DimInput({ value, units, precision, onChange, placeholder, className, ariaLabel, autoFocus }: DimInputProps) {
  const [text, setText] = useState<string | null>(null);
  const display = text ?? (value ? formatLength(value, units, precision) : '');
  const invalid = text != null && text.trim() !== '' && parseLength(text, units) == null;
  return (
    <input
      className={`input dim ${invalid ? 'invalid' : ''} ${className ?? ''}`}
      value={display}
      placeholder={placeholder ?? (units === 'in' ? 'in' : 'mm')}
      aria-label={ariaLabel}
      autoFocus={autoFocus}
      inputMode="decimal"
      onFocus={(e) => {
        setText(display);
        requestAnimationFrame(() => e.target.select());
      }}
      onChange={(e) => {
        setText(e.target.value);
        const v = parseLength(e.target.value, units);
        if (v != null && v >= 0) onChange(v);
        else if (e.target.value.trim() === '') onChange(0);
      }}
      onBlur={() => setText(null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setText(null);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

interface NumInputProps {
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  allowNull?: boolean;
  min?: number;
  integer?: boolean;
  prefix?: string;
}

export function NumInput({ value, onChange, placeholder, className, ariaLabel, allowNull, min = 0, integer, prefix }: NumInputProps) {
  const [text, setText] = useState<string | null>(null);
  const display = text ?? (value == null ? '' : String(value));
  const input = (
    <input
      className={`input num ${className ?? ''}`}
      value={display}
      placeholder={placeholder}
      aria-label={ariaLabel}
      inputMode={integer ? 'numeric' : 'decimal'}
      onFocus={(e) => {
        setText(display);
        requestAnimationFrame(() => e.target.select());
      }}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        if (t.trim() === '') {
          onChange(allowNull ? null : min);
          return;
        }
        const n = integer ? parseInt(t, 10) : parseFloat(t);
        if (!isNaN(n)) onChange(Math.max(min, n));
      }}
      onBlur={() => setText(null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (integer && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault();
          const n = (value ?? 0) + (e.key === 'ArrowUp' ? 1 : -1);
          setText(null);
          onChange(Math.max(min, n));
        }
      }}
    />
  );
  if (!prefix) return input;
  return (
    <span className="affix">
      <span className="affix-label">{prefix}</span>
      {input}
    </span>
  );
}

interface SegmentedProps<T extends string> {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
}

export function Segmented<T extends string>({ value, options, onChange, size = 'md' }: SegmentedProps<T>) {
  return (
    <div className={`segmented ${size}`} role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          className={value === o.value ? 'active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track">
        <span className="toggle-thumb" />
      </span>
      <span>{label}</span>
    </label>
  );
}

/** Small icon used to indicate grain direction. */
export function GrainIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M3 6c3-2 6 2 9 0s6 2 9 0" />
      <path d="M3 12c3-2 6 2 9 0s6 2 9 0" />
      <path d="M3 18c3-2 6 2 9 0s6 2 9 0" />
    </svg>
  );
}

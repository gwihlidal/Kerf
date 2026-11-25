import type { Units } from './types';

export const MM_PER_IN = 25.4;

function parseNumber(s: string): number | null {
  s = s.trim();
  if (!s) return null;
  let m = /^(\d+(?:\.\d*)?|\.\d+)$/.exec(s);
  if (m) return parseFloat(m[1]);
  m = /^(\d+)[\s-]+(\d+)\s*\/\s*(\d+)$/.exec(s);
  if (m) {
    const d = parseInt(m[3], 10);
    return d ? parseInt(m[1], 10) + parseInt(m[2], 10) / d : null;
  }
  m = /^(\d+)\s*\/\s*(\d+)$/.exec(s);
  if (m) {
    const d = parseInt(m[2], 10);
    return d ? parseInt(m[1], 10) / d : null;
  }
  return null;
}

function toUnits(value: number, from: Units, to: Units) {
  if (from === to) return value;
  return from === 'in' ? value * MM_PER_IN : value / MM_PER_IN;
}

/**
 * Parse a user-entered length. Accepts decimals, fractions ("23 1/2", "23-1/2", "3/4"),
 * feet/inches ("4'6\"", "8ft"), metric suffixes ("600mm", "60cm", "2.44m") and sums ("23 + 3/4").
 * Returns the value in `units`, or null when unparseable.
 */
export function parseLength(input: string, units: Units): number | null {
  const src = input.trim().toLowerCase().replace(/[″”]/g, '"').replace(/[′’]/g, "'").replace(/,/g, '.');
  if (!src) return null;
  let total = 0;
  for (const rawTerm of src.split('+')) {
    const term = rawTerm.trim();
    if (!term) return null;
    // Feet (+ optional inches).
    const ft = /^(.+?)\s*(?:'|ft|feet|foot)\s*(.*)$/.exec(term);
    if (ft) {
      const feet = parseNumber(ft[1]);
      if (feet == null) return null;
      let inches = 0;
      const rest = ft[2].replace(/(?:"|in|inch|inches)$/, '').trim();
      if (rest) {
        const r = parseNumber(rest);
        if (r == null) return null;
        inches = r;
      }
      total += toUnits(feet * 12 + inches, 'in', units);
      continue;
    }
    const u = /^(.+?)\s*(mm|cm|m|"|in|inch|inches)?$/.exec(term);
    if (!u) return null;
    const n = parseNumber(u[1]);
    if (n == null) return null;
    switch (u[2]) {
      case 'mm':
        total += toUnits(n, 'mm', units);
        break;
      case 'cm':
        total += toUnits(n * 10, 'mm', units);
        break;
      case 'm':
        total += toUnits(n * 1000, 'mm', units);
        break;
      case '"':
      case 'in':
      case 'inch':
      case 'inches':
        total += toUnits(n, 'in', units);
        break;
      default:
        total += n;
    }
  }
  return total;
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

/** Format a length for display. `precision` is the fraction denominator for inches (0 = decimal). */
export function formatLength(v: number, units: Units, precision = 16, withUnit = false): string {
  if (!isFinite(v)) return '';
  const neg = v < 0;
  v = Math.abs(v);
  let s: string;
  if (units === 'mm') {
    s = String(Math.round(v * 10) / 10);
    if (withUnit) s += ' mm';
  } else if (!precision) {
    s = String(Math.round(v * 1000) / 1000);
    if (withUnit) s += '″';
  } else {
    const total = Math.round(v * precision);
    const whole = Math.floor(total / precision);
    let num = total - whole * precision;
    let den = precision;
    if (num) {
      const g = gcd(num, den);
      num /= g;
      den /= g;
    }
    s = num ? (whole ? `${whole} ${num}/${den}` : `${num}/${den}`) : String(whole);
    if (withUnit) s += '″';
  }
  return neg ? '-' + s : s;
}

export function formatArea(a: number, units: Units): string {
  if (units === 'mm') {
    const m2 = a / 1e6;
    return `${m2 < 10 ? m2.toFixed(2) : m2.toFixed(1)} m²`;
  }
  const ft2 = a / 144;
  return `${ft2 < 10 ? ft2.toFixed(2) : ft2.toFixed(1)} ft²`;
}

/** Long run lengths (cut length totals). */
export function formatRun(v: number, units: Units): string {
  if (units === 'mm') return `${(v / 1000).toFixed(1)} m`;
  return `${(v / 12).toFixed(1)} ft`;
}

export function convertValue(v: number, from: Units, to: Units): number {
  const c = toUnits(v, from, to);
  return to === 'mm' ? Math.round(c * 10) / 10 : Math.round(c * 64) / 64;
}

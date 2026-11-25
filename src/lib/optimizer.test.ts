import { describe, expect, it } from 'vitest';
import { optimize } from './optimizer';
import { parseLength, formatLength } from './units';
import type { Project, Part, Stock, Solution } from './types';

const settings = {
  units: 'mm' as const, kerf: 3, trim: 0, mode: 'guillotine' as const, objective: 'waste' as const,
  effort: 'fast' as const, precision: 16, minOffcut: 50, showCuts: true, showLabels: true,
};
let n = 0;
const part = (length: number, width: number, qty = 1, grain = false, material = 'ply'): Part =>
  ({ id: `p${n++}`, name: `P${n}`, length, width, qty, grain, material, enabled: true });
const stock = (length: number, width: number, qty: number | null = null, extra: Partial<Stock> = {}): Stock =>
  ({ id: `s${n++}`, name: 'Sheet', length, width, qty, cost: 0, grain: true, material: 'ply', enabled: true, ...extra });

function validate(sol: Solution, kerf: number) {
  for (const s of sol.sheets) {
    for (const p of s.placements) {
      expect(p.x).toBeGreaterThanOrEqual(s.trim - 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(s.trim - 1e-6);
      expect(p.x + p.w).toBeLessThanOrEqual(s.length - s.trim + 1e-6);
      expect(p.y + p.h).toBeLessThanOrEqual(s.width - s.trim + 1e-6);
    }
    for (let i = 0; i < s.placements.length; i++)
      for (let j = i + 1; j < s.placements.length; j++) {
        const a = s.placements[i], b = s.placements[j];
        const sepX = a.x + a.w + kerf <= b.x + 1e-6 || b.x + b.w + kerf <= a.x + 1e-6;
        const sepY = a.y + a.h + kerf <= b.y + 1e-6 || b.y + b.h + kerf <= a.y + 1e-6;
        expect(sepX || sepY).toBe(true);
      }
  }
}

describe('optimizer', () => {
  it('fits exact tiling with zero kerf onto one sheet', () => {
    const p: Project = { name: 't', parts: [part(1220, 610, 4)], stock: [stock(2440, 1220)], settings: { ...settings, kerf: 0 } };
    const sol = optimize(p);
    expect(sol.stats.sheetCount).toBe(1);
    expect(sol.stats.yield).toBeCloseTo(1);
    validate(sol, 0);
  });

  it('respects kerf (exact tiling no longer fits)', () => {
    const p: Project = { name: 't', parts: [part(1220, 610, 4)], stock: [stock(2440, 1220)], settings };
    const sol = optimize(p);
    expect(sol.stats.sheetCount).toBe(2);
    validate(sol, 3);
  });

  it('respects grain lock', () => {
    // 1000 long part with grain cannot be rotated onto a 900x1200 sheet whose grain runs along 900.
    const p: Project = { name: 't', parts: [part(1000, 100, 1, true)], stock: [stock(900, 1200)], settings };
    const sol = optimize(p);
    expect(sol.unplaced[0]?.reason).toMatch(/Too large/);
    p.parts[0].grain = false;
    expect(optimize(p).stats.sheetCount).toBe(1);
  });

  it('handles many mixed parts, both modes, without overlaps', () => {
    const parts = [part(1830, 356, 2), part(775, 336, 5), part(813, 356, 2), part(381, 152, 4), part(330, 127, 8), part(600, 400, 3)];
    for (const mode of ['guillotine', 'nested'] as const) {
      const sol = optimize({ name: 't', parts, stock: [stock(2440, 1220)], settings: { ...settings, mode, trim: 10 } });
      expect(sol.unplaced.length).toBe(0);
      expect(sol.stats.partCount).toBe(24);
      validate(sol, 3);
    }
  });

  it('limits stock quantity and reports shortages', () => {
    const sol = optimize({ name: 't', parts: [part(2000, 1000, 3)], stock: [stock(2440, 1220, 2)], settings });
    expect(sol.stats.sheetCount).toBe(2);
    expect(sol.unplaced[0].count).toBe(1);
    expect(sol.unplaced[0].reason).toMatch(/Not enough/);
  });

  it('prefers the smaller sheet when it suffices', () => {
    const big = stock(2440, 1220), small = stock(1220, 610);
    const sol = optimize({ name: 't', parts: [part(500, 300, 2)], stock: [big, small], settings });
    expect(sol.sheets[0].stockId).toBe(small.id);
  });

  it('separates materials', () => {
    const sol = optimize({
      name: 't', parts: [part(500, 300, 1, false, 'ply'), part(500, 300, 1, false, 'mdf')],
      stock: [stock(2440, 1220), stock(2440, 1220, null, { material: 'MDF' })], settings,
    });
    expect(sol.stats.sheetCount).toBe(2);
  });
});

describe('units', () => {
  it('parses lengths', () => {
    expect(parseLength('23 1/2', 'in')).toBe(23.5);
    expect(parseLength('23-1/2', 'in')).toBe(23.5);
    expect(parseLength('3/4', 'in')).toBe(0.75);
    expect(parseLength(`4'6"`, 'in')).toBe(54);
    expect(parseLength('8ft', 'in')).toBe(96);
    expect(parseLength('25.4mm', 'in')).toBeCloseTo(1);
    expect(parseLength('1"', 'mm')).toBeCloseTo(25.4);
    expect(parseLength('60cm', 'mm')).toBe(600);
    expect(parseLength('10 + 1/2', 'in')).toBe(10.5);
    expect(parseLength('abc', 'in')).toBeNull();
  });
  it('formats lengths', () => {
    expect(formatLength(23.5, 'in', 16)).toBe('23 1/2');
    expect(formatLength(0.125, 'in', 16)).toBe('1/8');
    expect(formatLength(600, 'mm')).toBe('600');
    expect(formatLength(3.25, 'mm')).toBe('3.3');
  });
});

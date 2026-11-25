import { describe, expect, it } from 'vitest';
import { fenceKey, scheduleBatches } from './cutplan';
import { optimize } from './optimizer';
import type { Part, Project, Solution, Stock } from './types';

const settings = {
  units: 'mm' as const, kerf: 3, trim: 0, mode: 'guillotine' as const, objective: 'waste' as const,
  effort: 'fast' as const, precision: 16, minOffcut: 50, showCuts: true, showLabels: true,
};
let n = 0;
const part = (length: number, width: number, qty = 1, material = 'ply'): Part =>
  ({ id: `p${n++}`, name: `P${n}`, length, width, qty, grain: true, material, enabled: true });
const stock = (length: number, width: number, material = 'ply'): Stock =>
  ({ id: `s${n++}`, name: 'Sheet', length, width, qty: null, cost: 0, grain: true, material, enabled: true });

function checkPlan(sol: Solution) {
  let total = 0;
  sol.sheets.forEach((s, si) => {
    total += s.cuts.length;
    s.cuts.forEach((c, i) => {
      // Parent cut must come first, and steps never go backwards within a sheet.
      expect(c.parent).toBeLessThan(i);
      if (i > 0) expect(c.step).toBeGreaterThanOrEqual(s.cuts[i - 1].step);
      const step = sol.plan[c.step - 1];
      expect(step).toBeDefined();
      expect(fenceKey(step)).toBe(fenceKey(c));
      expect(step.sheets.some((x) => x.sheet === si)).toBe(true);
    });
  });
  expect(sol.plan.reduce((a, p) => a + p.count, 0)).toBe(total);
  expect(sol.stats.setups).toBe(sol.plan.length);
}

describe('cut plan', () => {
  it('scheduler respects dependencies and batches identical settings', () => {
    // Sheet: rip 100 (0) -> remainder rip 100 (1) -> remainder rip 100 (2); each strip crosscut at 50.
    const cuts = [
      { dir: 'h' as const, offset: 100, parent: -1 },
      { dir: 'v' as const, offset: 50, parent: 0 },
      { dir: 'h' as const, offset: 100, parent: 0 },
      { dir: 'v' as const, offset: 50, parent: 2 },
      { dir: 'h' as const, offset: 100, parent: 2 },
      { dir: 'v' as const, offset: 50, parent: 4 },
    ];
    const batches = scheduleBatches([{ cuts }, { cuts }]);
    expect(batches.length).toBe(2);
    expect(batches[0].dir).toBe('h');
    expect(batches[0].refs.length).toBe(6);
    expect(batches[1].refs.length).toBe(6);
  });

  it('identical strips need very few setups', () => {
    const sol = optimize({ name: 't', parts: [part(2440, 300, 8)], stock: [stock(2440, 1220)], settings });
    checkPlan(sol);
    expect(sol.stats.sheetCount).toBe(2);
    expect(sol.plan.length).toBeLessThanOrEqual(2);
  });

  it('produces a valid plan for mixed parts across sheets and materials', () => {
    for (const objective of ['waste', 'cuts'] as const) {
      const p: Project = {
        name: 't',
        parts: [
          part(1830, 356, 2), part(813, 356, 2), part(775, 336, 5), part(381, 152, 4),
          part(330, 127, 8), part(343, 114, 4), part(1830, 813, 1, 'thin'), part(343, 324, 4, 'thin'),
        ],
        stock: [stock(2440, 1220), stock(2440, 1220, 'thin')],
        settings: { ...settings, objective, trim: 5 },
      };
      const sol = optimize(p);
      checkPlan(sol);
      expect(sol.plan.length).toBeLessThan(sol.stats.cutCount);
    }
  });

  it('nested mode has no plan', () => {
    const sol = optimize({ name: 't', parts: [part(500, 300, 4)], stock: [stock(2440, 1220)], settings: { ...settings, mode: 'nested' } });
    expect(sol.plan).toEqual([]);
  });
});

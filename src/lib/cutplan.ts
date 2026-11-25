/**
 * Batch cut planning.
 *
 * Guillotine cuts form a tree per sheet: a cut can only be made once the piece it cuts exists
 * (i.e. after its parent cut). Within those constraints we are free to reorder, so we group cuts
 * that share a fence setting (direction + distance) into batches — across every sheet of the same
 * material — to minimise how often the saw has to be re-set. Identical strips naturally end up
 * being processed together.
 */
import type { Cut, PlanStep, SheetResult } from './types';

type CutLike = Pick<Cut, 'dir' | 'offset' | 'parent'>;

export interface CutRef {
  sheet: number;
  index: number;
}

export interface Batch {
  dir: 'h' | 'v';
  offset: number;
  refs: CutRef[];
}

/** Fence settings are compared at 1/1000 of a unit. */
export function fenceKey(c: Pick<Cut, 'dir' | 'offset'>): string {
  return `${c.dir}:${Math.round(c.offset * 1000)}`;
}

interface Candidate {
  key: string;
  /** Cuts doable now with this setting, including ones unlocked during the run. */
  size: number;
  /** Cuts with this setting still to do in total. */
  remaining: number;
  minDepth: number;
  rip: boolean;
  offset: number;
}

type Picker = (cands: Candidate[]) => Candidate;

const tieBreak = (a: Candidate, b: Candidate) =>
  a.minDepth - b.minDepth || (a.rip === b.rip ? 0 : a.rip ? -1 : 1) || b.offset - a.offset;

/** Longest run first. */
const pickClosure: Picker = (cs) => cs.slice().sort((a, b) => b.size - a.size || tieBreak(a, b))[0];

/** Prefer settings that can be finished now (never revisited), then longest run. */
const pickComplete: Picker = (cs) =>
  cs
    .slice()
    .sort(
      (a, b) =>
        Number(b.size >= b.remaining) - Number(a.size >= a.remaining) || b.size - a.size || tieBreak(a, b),
    )[0];

/** Highest share of the setting's remaining cuts first. */
const pickRatio: Picker = (cs) =>
  cs.slice().sort((a, b) => b.size / b.remaining - a.size / a.remaining || b.size - a.size || tieBreak(a, b))[0];

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomPicker(seed: number): Picker {
  const rand = rng(seed);
  return (cs) => {
    let best = cs[0];
    let bestScore = -Infinity;
    for (const c of cs) {
      const complete = c.size >= c.remaining ? 1 : 0;
      const s = (c.size + 2 * complete) * (0.4 + rand()) + (c.size / c.remaining) * rand();
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    return best;
  };
}

/**
 * Batch scheduler: tries several greedy strategies plus randomized restarts and keeps the plan with
 * the fewest fence setups. Every plan respects the cut dependencies.
 */
export function scheduleBatches(sheets: { cuts: CutLike[] }[], restarts = 96): Batch[] {
  const total = sheets.reduce((a, s) => a + s.cuts.length, 0);
  if (total === 0) return [];
  const pickers: Picker[] = [pickComplete, pickClosure, pickRatio];
  // Keep the randomized search bounded for very large jobs.
  const n = Math.max(8, Math.min(restarts, Math.floor(200000 / Math.max(1, total))));
  for (let i = 0; i < n; i++) pickers.push(randomPicker(0x51ed + i * 7919));
  let best: Batch[] | null = null;
  for (const pick of pickers) {
    const plan = runSchedule(sheets, pick);
    if (!best || plan.length < best.length) best = plan;
  }
  return best!;
}

/**
 * One greedy pass. At each step the picker chooses a fence setting among those with available cuts;
 * the batch then runs every cut with that setting, including cuts that become possible during the run.
 */
function runSchedule(sheets: { cuts: CutLike[] }[], pick: Picker): Batch[] {
  const children: number[][][] = sheets.map((s) => s.cuts.map(() => []));
  const depth: number[][] = sheets.map((s) => s.cuts.map(() => 0));
  const keys: string[][] = sheets.map((s) => s.cuts.map(fenceKey));
  let available: CutRef[] = [];

  sheets.forEach((s, si) => {
    s.cuts.forEach((c, i) => {
      if (c.parent >= 0 && c.parent < s.cuts.length) {
        children[si][c.parent].push(i);
        depth[si][i] = depth[si][c.parent] + 1;
      } else {
        available.push({ sheet: si, index: i });
      }
    });
  });

  const keyOf = (r: CutRef) => keys[r.sheet][r.index];

  const closureSize = (key: string) => {
    let n = 0;
    const stack = available.filter((r) => keyOf(r) === key);
    while (stack.length) {
      const r = stack.pop()!;
      n++;
      for (const ch of children[r.sheet][r.index]) if (keys[r.sheet][ch] === key) stack.push({ sheet: r.sheet, index: ch });
    }
    return n;
  };

  const remaining = new Map<string, number>();
  for (const ks of keys) for (const k of ks) remaining.set(k, (remaining.get(k) ?? 0) + 1);

  const batches: Batch[] = [];
  while (available.length) {
    const first = new Map<string, { ref: CutRef; minDepth: number }>();
    for (const r of available) {
      const k = keyOf(r);
      const d = depth[r.sheet][r.index];
      const c = first.get(k);
      if (!c || d < c.minDepth) first.set(k, { ref: r, minDepth: d });
    }
    const cands: Candidate[] = [];
    for (const [k, c] of first) {
      const cut = sheets[c.ref.sheet].cuts[c.ref.index];
      cands.push({
        key: k,
        size: closureSize(k),
        remaining: remaining.get(k) ?? 1,
        minDepth: c.minDepth,
        rip: cut.dir === 'h',
        offset: cut.offset,
      });
    }
    const bestKey = pick(cands).key;

    // Execute the batch: breadth-first through cuts with this key, unlocking children as we go.
    const refs: CutRef[] = [];
    const queue = available.filter((r) => keyOf(r) === bestKey);
    const rest = available.filter((r) => keyOf(r) !== bestKey);
    for (let qi = 0; qi < queue.length; qi++) {
      const r = queue[qi];
      refs.push(r);
      for (const ch of children[r.sheet][r.index]) {
        const cr = { sheet: r.sheet, index: ch };
        if (keys[r.sheet][ch] === bestKey) queue.push(cr);
        else rest.push(cr);
      }
    }
    // Keep a stable sheet-major order inside the batch so the shop list reads naturally.
    refs.sort((a, b) => a.sheet - b.sheet);
    remaining.set(bestKey, (remaining.get(bestKey) ?? 0) - refs.length);
    const lead = sheets[refs[0].sheet].cuts[refs[0].index];
    batches.push({ dir: lead.dir, offset: lead.offset, refs });
    available = rest;
  }
  return batches;
}

/**
 * Builds the project cutting plan. Sheets are planned per material; each sheet's cut list is
 * reordered (in place) to follow the plan, and every cut is tagged with its plan step.
 */
export function planCuts(sheets: SheetResult[]): PlanStep[] {
  const byMaterial = new Map<string, number[]>();
  sheets.forEach((s, i) => {
    if (s.cuts.length === 0) return;
    const k = s.material.trim().toLowerCase();
    if (!byMaterial.has(k)) byMaterial.set(k, []);
    byMaterial.get(k)!.push(i);
  });

  const plan: PlanStep[] = [];
  const order: { step: number; seq: number }[][] = sheets.map((s) => s.cuts.map(() => ({ step: 0, seq: 0 })));
  let seq = 0;

  for (const idxs of byMaterial.values()) {
    const batches = scheduleBatches(idxs.map((i) => sheets[i]));
    for (const b of batches) {
      const step = plan.length + 1;
      const perSheet = new Map<number, number>();
      for (const r of b.refs) {
        const si = idxs[r.sheet];
        order[si][r.index] = { step, seq: seq++ };
        perSheet.set(si, (perSheet.get(si) ?? 0) + 1);
      }
      plan.push({
        step,
        material: sheets[idxs[0]].material,
        dir: b.dir,
        offset: b.offset,
        count: b.refs.length,
        sheets: [...perSheet.entries()].map(([sheet, count]) => ({ sheet, count })),
      });
    }
  }

  // Reorder each sheet's cuts to follow the plan and remap parent indices.
  sheets.forEach((s, si) => {
    if (s.cuts.length === 0) return;
    const perm = s.cuts.map((_, i) => i).sort((a, b) => order[si][a].seq - order[si][b].seq);
    const newIndex = new Array<number>(s.cuts.length);
    perm.forEach((old, ni) => (newIndex[old] = ni));
    s.cuts = perm.map((old) => {
      const c = s.cuts[old];
      return { ...c, step: order[si][old].step, parent: c.parent >= 0 ? newIndex[c.parent] : -1 };
    });
  });

  return plan;
}

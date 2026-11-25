/**
 * Cut-list optimizer.
 *
 * Kerf is handled with the classic inflation trick: every part is grown by one
 * kerf in each dimension and the usable sheet area is grown by one kerf too.
 * Packing is then a pure rectangle-packing problem with zero gaps.
 *
 * Two packers are provided:
 *  - Guillotine: every cut runs edge-to-edge through the current piece, which is
 *    what a table saw / panel saw can actually do. Produces a cut sequence.
 *  - MaxRects ("nested"): free-form placement for CNC routers. Denser, no cut sequence.
 *
 * A search driver runs many deterministic heuristic combinations, then spends
 * the remaining time budget on randomized local search over part orderings.
 */
import type {
  CutMode,
  Cut,
  Effort,
  Part,
  Placement,
  Project,
  Rect,
  SheetResult,
  Solution,
  Stock,
  Unplaced,
} from './types';
import { planCuts } from './cutplan';

const EPS = 1e-7;

interface Item {
  key: number;
  partId: string;
  name: string;
  instance: number;
  length: number;
  width: number;
  grain: boolean;
  area: number;
}

interface Placed {
  item: Item;
  /** Inflated-space coordinates (top-left). */
  x: number;
  y: number;
  /** Real part extent on the sheet. */
  w: number;
  h: number;
  rotated: boolean;
}

type FitRule = 'baf' | 'bssf' | 'blsf' | 'bl';
type SplitRule = 'sla' | 'lla' | 'minas' | 'maxas' | 'sa' | 'la' | 'h' | 'v';

interface Config {
  fit: FitRule;
  split: SplitRule;
}

interface Bin {
  placed: Placed[];
  cuts: Cut[];
  insert(item: Item, canRotate: boolean): boolean;
  free(): Rect[];
}

function fitScore(rule: FitRule, f: Rect, iw: number, ih: number): number {
  switch (rule) {
    case 'baf':
      return f.w * f.h - iw * ih;
    case 'bssf':
      return Math.min(f.w - iw, f.h - ih);
    case 'blsf':
      return Math.max(f.w - iw, f.h - ih);
    case 'bl':
      return f.y + ih;
  }
}

/* ------------------------------------------------------------------ */
/* Guillotine packer                                                   */
/* ------------------------------------------------------------------ */

/** A free rectangle plus the index of the cut that produced it (-1 = the full sheet). */
interface FreeRect extends Rect {
  src: number;
}

class GuillotineBin implements Bin {
  placed: Placed[] = [];
  cuts: Cut[] = [];
  private rects: FreeRect[];
  private k: number;
  private cfg: Config;

  constructor(W: number, H: number, kerf: number, cfg: Config) {
    this.rects = [{ x: 0, y: 0, w: W, h: H, src: -1 }];
    this.k = kerf;
    this.cfg = cfg;
  }

  free(): Rect[] {
    return this.rects;
  }

  insert(item: Item, canRotate: boolean): boolean {
    const k = this.k;
    let bi = -1;
    let bRot = false;
    let bScore = Infinity;
    let bTieY = Infinity;
    let bTieX = Infinity;
    const orients = canRotate && Math.abs(item.length - item.width) > EPS ? [false, true] : [false];
    for (let i = 0; i < this.rects.length; i++) {
      const f = this.rects[i];
      for (const rot of orients) {
        const iw = (rot ? item.width : item.length) + k;
        const ih = (rot ? item.length : item.width) + k;
        if (iw > f.w + EPS || ih > f.h + EPS) continue;
        const s = fitScore(this.cfg.fit, f, iw, ih);
        if (
          s < bScore - EPS ||
          (Math.abs(s - bScore) <= EPS && (f.y < bTieY - EPS || (Math.abs(f.y - bTieY) <= EPS && f.x < bTieX)))
        ) {
          bi = i;
          bRot = rot;
          bScore = s;
          bTieY = f.y;
          bTieX = f.x;
        }
      }
    }
    if (bi < 0) return false;

    const f = this.rects[bi];
    this.rects[bi] = this.rects[this.rects.length - 1];
    this.rects.pop();

    const w = bRot ? item.width : item.length;
    const h = bRot ? item.length : item.width;
    const iw = w + k;
    const ih = h + k;
    this.placed.push({ item, x: f.x, y: f.y, w, h, rotated: bRot });

    const rw = f.w - iw;
    const bh = f.h - ih;
    const horizontal = this.splitHorizontal(f, iw, ih, rw, bh);
    const pieceW = f.w - k;
    const pieceH = f.h - k;
    // `parent` is the index of the cut that produced the piece being cut (-1 = the full sheet).
    const cut = (c: Omit<Cut, 'parent' | 'step'>, parent: number) => {
      this.cuts.push({ ...c, parent, step: 0 });
      return this.cuts.length - 1;
    };

    if (horizontal) {
      // Full-width cut first (along x), then cut the strip.
      let strip = f.src;
      let first = -1;
      if (bh > EPS) {
        const y = f.y + ih - k / 2;
        first = cut({ dir: 'h', x1: f.x, y1: y, x2: f.x + pieceW, y2: y, pieceW, pieceH, offset: h }, f.src);
        strip = first;
      }
      let second = -1;
      if (rw > EPS) {
        const x = f.x + iw - k / 2;
        second = cut({ dir: 'v', x1: x, y1: f.y, x2: x, y2: f.y + Math.min(h, pieceH), pieceW, pieceH: h, offset: w }, strip);
      }
      this.push({ x: f.x, y: f.y + ih, w: f.w, h: bh, src: first });
      this.push({ x: f.x + iw, y: f.y, w: rw, h: ih, src: second });
    } else {
      let col = f.src;
      let first = -1;
      if (rw > EPS) {
        const x = f.x + iw - k / 2;
        first = cut({ dir: 'v', x1: x, y1: f.y, x2: x, y2: f.y + pieceH, pieceW, pieceH, offset: w }, f.src);
        col = first;
      }
      let second = -1;
      if (bh > EPS) {
        const y = f.y + ih - k / 2;
        second = cut({ dir: 'h', x1: f.x, y1: y, x2: f.x + Math.min(w, pieceW), y2: y, pieceW: w, pieceH, offset: h }, col);
      }
      this.push({ x: f.x + iw, y: f.y, w: rw, h: f.h, src: first });
      this.push({ x: f.x, y: f.y + ih, w: iw, h: bh, src: second });
    }
    return true;
  }

  private push(r: FreeRect) {
    // Anything not larger than a kerf can never hold a part.
    if (r.w > this.k + EPS && r.h > this.k + EPS) this.rects.push(r);
  }

  private splitHorizontal(f: Rect, iw: number, ih: number, rw: number, bh: number): boolean {
    switch (this.cfg.split) {
      case 'sla':
        return rw <= bh;
      case 'lla':
        return rw > bh;
      case 'minas':
        return iw * bh > rw * ih;
      case 'maxas':
        return iw * bh <= rw * ih;
      case 'sa':
        return f.w <= f.h;
      case 'la':
        return f.w > f.h;
      case 'h':
        return true;
      case 'v':
        return false;
    }
  }
}

/* ------------------------------------------------------------------ */
/* MaxRects packer                                                     */
/* ------------------------------------------------------------------ */

class MaxRectsBin implements Bin {
  placed: Placed[] = [];
  cuts: Cut[] = [];
  private rects: Rect[];
  private k: number;
  private cfg: Config;

  constructor(W: number, H: number, kerf: number, cfg: Config) {
    this.rects = [{ x: 0, y: 0, w: W, h: H }];
    this.k = kerf;
    this.cfg = cfg;
  }

  free(): Rect[] {
    return this.rects;
  }

  insert(item: Item, canRotate: boolean): boolean {
    const k = this.k;
    let bi = -1;
    let bRot = false;
    let bScore = Infinity;
    let bTie = Infinity;
    const orients = canRotate && Math.abs(item.length - item.width) > EPS ? [false, true] : [false];
    for (let i = 0; i < this.rects.length; i++) {
      const f = this.rects[i];
      for (const rot of orients) {
        const iw = (rot ? item.width : item.length) + k;
        const ih = (rot ? item.length : item.width) + k;
        if (iw > f.w + EPS || ih > f.h + EPS) continue;
        const s = fitScore(this.cfg.fit, f, iw, ih);
        const tie =
          this.cfg.fit === 'bl' ? f.x : this.cfg.fit === 'bssf' ? Math.max(f.w - iw, f.h - ih) : Math.min(f.w - iw, f.h - ih);
        if (s < bScore - EPS || (Math.abs(s - bScore) <= EPS && tie < bTie)) {
          bi = i;
          bRot = rot;
          bScore = s;
          bTie = tie;
        }
      }
    }
    if (bi < 0) return false;

    const f = this.rects[bi];
    const w = bRot ? item.width : item.length;
    const h = bRot ? item.length : item.width;
    const node: Rect = { x: f.x, y: f.y, w: w + k, h: h + k };
    this.placed.push({ item, x: f.x, y: f.y, w, h, rotated: bRot });

    const next: Rect[] = [];
    for (const r of this.rects) {
      if (
        node.x >= r.x + r.w - EPS ||
        node.x + node.w <= r.x + EPS ||
        node.y >= r.y + r.h - EPS ||
        node.y + node.h <= r.y + EPS
      ) {
        next.push(r);
        continue;
      }
      if (node.x > r.x + EPS) next.push({ x: r.x, y: r.y, w: node.x - r.x, h: r.h });
      if (node.x + node.w < r.x + r.w - EPS)
        next.push({ x: node.x + node.w, y: r.y, w: r.x + r.w - (node.x + node.w), h: r.h });
      if (node.y > r.y + EPS) next.push({ x: r.x, y: r.y, w: r.w, h: node.y - r.y });
      if (node.y + node.h < r.y + r.h - EPS)
        next.push({ x: r.x, y: node.y + node.h, w: r.w, h: r.y + r.h - (node.y + node.h) });
    }
    // Prune degenerate and contained rectangles.
    const filtered = next.filter((r) => r.w > k + EPS && r.h > k + EPS);
    const out: Rect[] = [];
    for (let i = 0; i < filtered.length; i++) {
      const a = filtered[i];
      let contained = false;
      for (let j = 0; j < filtered.length; j++) {
        if (i === j) continue;
        const b = filtered[j];
        if (
          a.x >= b.x - EPS &&
          a.y >= b.y - EPS &&
          a.x + a.w <= b.x + b.w + EPS &&
          a.y + a.h <= b.y + b.h + EPS &&
          // Break ties between identical rects by index.
          (a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h || i > j)
        ) {
          contained = true;
          break;
        }
      }
      if (!contained) out.push(a);
    }
    this.rects = out;
    return true;
  }
}

/* ------------------------------------------------------------------ */
/* Multi-sheet packing                                                 */
/* ------------------------------------------------------------------ */

interface PackedSheet {
  stock: Stock;
  bin: Bin;
  partArea: number;
}

interface Packing {
  sheets: PackedSheet[];
  unplaced: Item[];
  score: number[];
}

interface GroupContext {
  stocks: Stock[];
  kerf: number;
  trim: number;
  mode: CutMode;
  useCost: boolean;
  objective: 'waste' | 'cuts';
}

function usable(s: Stock, trim: number) {
  return { W: s.length - 2 * trim, H: s.width - 2 * trim };
}

function canRotate(item: Item, s: Stock) {
  return !(item.grain && s.grain);
}

function fitsEmpty(item: Item, s: Stock, trim: number): boolean {
  const { W, H } = usable(s, trim);
  if (item.length <= W + EPS && item.width <= H + EPS) return true;
  return canRotate(item, s) && item.width <= W + EPS && item.length <= H + EPS;
}

function packSheet(items: Item[], s: Stock, ctx: GroupContext, cfg: Config): PackedSheet {
  const { W, H } = usable(s, ctx.trim);
  const bin: Bin =
    ctx.mode === 'guillotine'
      ? new GuillotineBin(W + ctx.kerf, H + ctx.kerf, ctx.kerf, cfg)
      : new MaxRectsBin(W + ctx.kerf, H + ctx.kerf, ctx.kerf, cfg);
  let partArea = 0;
  for (const it of items) {
    if (bin.insert(it, canRotate(it, s))) partArea += it.area;
  }
  return { stock: s, bin, partArea };
}

function stockValue(s: Stock, useCost: boolean) {
  return useCost ? s.cost : s.length * s.width;
}

function packAll(order: Item[], ctx: GroupContext, cfg: Config): Packing {
  const left = new Map<string, number>();
  for (const s of ctx.stocks) left.set(s.id, s.qty == null ? Infinity : s.qty);

  let remaining = order;
  const sheets: PackedSheet[] = [];

  while (remaining.length > 0) {
    let best: PackedSheet | null = null;
    let bestAll = false;
    let bestMetric = Infinity;
    for (const s of ctx.stocks) {
      if ((left.get(s.id) ?? 0) <= 0) continue;
      const p = packSheet(remaining, s, ctx, cfg);
      if (p.bin.placed.length === 0) continue;
      const all = p.bin.placed.length === remaining.length;
      // When everything fits, prefer the cheapest/smallest sheet;
      // otherwise prefer the best value (placed area per unit cost/area).
      const metric = all
        ? stockValue(s, ctx.useCost)
        : -(p.partArea / Math.max(stockValue(s, ctx.useCost), 1e-9));
      if (!best || (all && !bestAll) || (all === bestAll && metric < bestMetric - EPS)) {
        best = p;
        bestAll = all;
        bestMetric = metric;
      }
    }
    if (!best) break;
    sheets.push(best);
    left.set(best.stock.id, (left.get(best.stock.id) ?? 0) - 1);
    const placedKeys = new Set(best.bin.placed.map((p) => p.item.key));
    remaining = remaining.filter((it) => !placedKeys.has(it.key));
  }

  return { sheets, unplaced: remaining, score: scorePacking(sheets, remaining, ctx) };
}

function scorePacking(sheets: PackedSheet[], unplaced: Item[], ctx: GroupContext): number[] {
  let unplacedArea = 0;
  for (const it of unplaced) unplacedArea += it.area;
  let used = 0;
  let cuts = 0;
  let largestFree = 0;
  let maxSheet = 0;
  // Distinct fence settings across the group: a cheap proxy for the setups in the batched plan.
  const settings = new Set<number>();
  for (const sh of sheets) {
    used += stockValue(sh.stock, ctx.useCost);
    cuts += sh.bin.cuts.length;
    maxSheet = Math.max(maxSheet, sh.stock.length * sh.stock.width);
    for (const c of sh.bin.cuts) {
      const r = Math.round(c.offset * 1000);
      settings.add(c.dir === 'h' ? r : -r - 1);
    }
    for (const r of sh.bin.free()) {
      const a = (r.w - ctx.kerf) * (r.h - ctx.kerf);
      if (a > largestFree) largestFree = a;
    }
  }
  // Area-based stock value as a secondary measure when cost is the primary one.
  let area = 0;
  for (const sh of sheets) area += sh.stock.length * sh.stock.width;
  const setups = settings.size;
  if (ctx.objective === 'cuts') return [unplacedArea, used, area, cuts + 2 * setups, -largestFree];
  // Largest offcut in 5%-of-sheet buckets so that fewer setups can break near-ties.
  const offcut = maxSheet > 0 ? Math.floor((largestFree / maxSheet) * 20) : 0;
  return [unplacedArea, used, area, -offcut, setups, cuts, -largestFree];
}

function better(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const tol = Math.max(1e-6, Math.abs(b[i]) * 1e-9);
    if (a[i] < b[i] - tol) return true;
    if (a[i] > b[i] + tol) return false;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

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

const SORTS: ((a: Item, b: Item) => number)[] = [
  (a, b) => b.area - a.area,
  (a, b) => Math.max(b.length, b.width) - Math.max(a.length, a.width) || b.area - a.area,
  (a, b) => b.length + b.width - (a.length + a.width) || b.area - a.area,
  (a, b) => b.length - a.length || b.width - a.width,
  (a, b) => b.width - a.width || b.length - a.length,
  (a, b) => Math.min(b.length, b.width) - Math.min(a.length, a.width) || b.area - a.area,
];

const BUDGET_MS: Record<Effort, number> = { fast: 250, balanced: 1200, thorough: 4500 };
/** Stop local search after this many evaluations without improvement. */
const PATIENCE: Record<Effort, number> = { fast: 2000, balanced: 15000, thorough: 80000 };

export interface ProgressInfo {
  solution: Solution;
  progress: number;
}

interface GroupResult {
  packing: Packing;
  ctx: GroupContext;
  evaluations: number;
}

function searchGroup(
  items: Item[],
  ctx: GroupContext,
  budgetMs: number,
  seed: number,
  patience: number,
  onImprove: (p: Packing, fraction: number) => void,
): GroupResult {
  const start = performance.now();
  const fits: FitRule[] = ['baf', 'bssf', 'blsf', 'bl'];
  const splits: SplitRule[] =
    ctx.mode === 'guillotine' ? ['sla', 'lla', 'minas', 'maxas', 'sa', 'la', 'h', 'v'] : ['sla'];

  let best: Packing | null = null;
  let evaluations = 0;
  let lastImprove = 0;
  const top: { cfg: Config; order: Item[]; packing: Packing }[] = [];

  const consider = (order: Item[], cfg: Config): Packing => {
    const p = packAll(order, ctx, cfg);
    evaluations++;
    if (!best || better(p.score, best.score)) {
      best = p;
      lastImprove = evaluations;
      onImprove(p, Math.min(1, (performance.now() - start) / budgetMs));
    }
    return p;
  };

  // Phase 1: deterministic heuristic sweep.
  for (const sort of SORTS) {
    const order = items.slice().sort(sort);
    for (const fit of fits) {
      for (const split of splits) {
        const cfg = { fit, split };
        const p = consider(order, cfg);
        top.push({ cfg, order, packing: p });
      }
    }
  }
  top.sort((a, b) => (better(a.packing.score, b.packing.score) ? -1 : better(b.packing.score, a.packing.score) ? 1 : 0));
  const elite = top.slice(0, 6);

  // Phase 2: randomized local search on the orderings of the best candidates.
  const rand = rng(seed);
  if (items.length > 1) {
    while (performance.now() - start < budgetMs && evaluations - lastImprove < patience) {
      const e = elite[Math.floor(rand() * elite.length)];
      const order = e.order.slice();
      const moves = 1 + Math.floor(rand() * Math.min(4, order.length));
      for (let m = 0; m < moves; m++) {
        const i = Math.floor(rand() * order.length);
        const j = Math.floor(rand() * order.length);
        if (rand() < 0.5) {
          const t = order[i];
          order[i] = order[j];
          order[j] = t;
        } else {
          const [x] = order.splice(i, 1);
          order.splice(j, 0, x);
        }
      }
      let cfg = e.cfg;
      if (rand() < 0.15) {
        cfg = { fit: fits[Math.floor(rand() * fits.length)], split: splits[Math.floor(rand() * splits.length)] };
      }
      const p = consider(order, cfg);
      if (!better(e.packing.score, p.score)) {
        // Accept equal-or-better moves to keep drifting across plateaus.
        e.order = order;
        e.cfg = cfg;
        e.packing = p;
      }
    }
  }

  return { packing: best!, ctx, evaluations };
}

/* ------------------------------------------------------------------ */
/* Result assembly                                                     */
/* ------------------------------------------------------------------ */

function nonOverlapping(rects: Rect[]): Rect[] {
  const sorted = rects.slice().sort((a, b) => b.w * b.h - a.w * a.h);
  const out: Rect[] = [];
  for (const r of sorted) {
    const overlaps = out.some(
      (o) => r.x < o.x + o.w - EPS && r.x + r.w > o.x + EPS && r.y < o.y + o.h - EPS && r.y + r.h > o.y + EPS,
    );
    if (!overlaps) out.push(r);
  }
  return out;
}

function toSheetResult(ps: PackedSheet, ctx: GroupContext, minOffcut: number): SheetResult {
  const t = ctx.trim;
  const k = ctx.kerf;
  const placements: Placement[] = ps.bin.placed.map((p) => ({
    partId: p.item.partId,
    name: p.item.name,
    instance: p.item.instance,
    rotated: p.rotated,
    length: p.item.length,
    width: p.item.width,
    x: p.x + t,
    y: p.y + t,
    w: p.w,
    h: p.h,
  }));
  const cuts: Cut[] = ps.bin.cuts.map((c) => ({ ...c, x1: c.x1 + t, x2: c.x2 + t, y1: c.y1 + t, y2: c.y2 + t }));
  const free = ps.bin
    .free()
    .map((r) => ({ x: r.x + t, y: r.y + t, w: r.w - k, h: r.h - k }))
    .filter((r) => r.w >= minOffcut - EPS && r.h >= minOffcut - EPS && r.w > EPS && r.h > EPS);
  const offcuts = ctx.mode === 'nested' ? nonOverlapping(free) : free.sort((a, b) => b.w * b.h - a.w * a.h);
  return {
    stockId: ps.stock.id,
    stockName: ps.stock.name,
    material: ps.stock.material,
    length: ps.stock.length,
    width: ps.stock.width,
    grain: ps.stock.grain,
    trim: t,
    cost: ps.stock.cost,
    placements,
    cuts,
    offcuts,
    partArea: ps.partArea,
  };
}

function buildSolution(
  groups: { packing: Packing; ctx: GroupContext }[],
  extraUnplaced: Unplaced[],
  project: Project,
  elapsedMs: number,
  evaluations: number,
): Solution {
  const sheets: SheetResult[] = [];
  const unplacedMap = new Map<string, Unplaced>();
  for (const u of extraUnplaced) unplacedMap.set(u.partId + u.reason, { ...u });

  for (const g of groups) {
    for (const ps of g.packing.sheets) sheets.push(toSheetResult(ps, g.ctx, project.settings.minOffcut));
    for (const it of g.packing.unplaced) {
      const tooBig = !g.ctx.stocks.some((s) => fitsEmpty(it, s, g.ctx.trim));
      const reason = tooBig ? 'Too large for any stock sheet' : 'Not enough stock sheets';
      const key = it.partId + reason;
      const u = unplacedMap.get(key);
      if (u) u.count++;
      else unplacedMap.set(key, { partId: it.partId, name: it.name, count: 1, reason });
    }
  }

  const plan = planCuts(sheets);

  let stockArea = 0;
  let partArea = 0;
  let cutCount = 0;
  let cutLength = 0;
  let cost = 0;
  let partCount = 0;
  const perStock = new Map<string, { stockId: string; name: string; material: string; count: number }>();
  for (const s of sheets) {
    stockArea += s.length * s.width;
    partArea += s.partArea;
    cutCount += s.cuts.length;
    for (const c of s.cuts) cutLength += Math.abs(c.x2 - c.x1) + Math.abs(c.y2 - c.y1);
    cost += s.cost;
    partCount += s.placements.length;
    const ps = perStock.get(s.stockId);
    if (ps) ps.count++;
    else perStock.set(s.stockId, { stockId: s.stockId, name: s.stockName, material: s.material, count: 1 });
  }

  return {
    sheets,
    unplaced: [...unplacedMap.values()],
    plan,
    stats: {
      sheetCount: sheets.length,
      stockArea,
      partArea,
      yield: stockArea > 0 ? partArea / stockArea : 0,
      cutCount,
      setups: plan.length,
      cutLength,
      cost,
      partCount,
      perStock: [...perStock.values()],
    },
    elapsedMs,
    evaluations,
    mode: project.settings.mode,
  };
}

/* ------------------------------------------------------------------ */
/* Public entry point                                                  */
/* ------------------------------------------------------------------ */

export function optimize(project: Project, onProgress?: (info: ProgressInfo) => void): Solution {
  const start = performance.now();
  const { settings } = project;
  const parts = project.parts.filter((p) => p.enabled && p.qty > 0 && p.length > 0 && p.width > 0);
  const stocks = project.stock.filter(
    (s) => s.enabled && s.length > 0 && s.width > 0 && (s.qty == null || s.qty > 0),
  );

  // Group by material (case-insensitive).
  const norm = (m: string) => m.trim().toLowerCase();
  const materials = new Map<string, { parts: Part[]; stocks: Stock[] }>();
  for (const p of parts) {
    const k = norm(p.material);
    if (!materials.has(k)) materials.set(k, { parts: [], stocks: [] });
    materials.get(k)!.parts.push(p);
  }
  for (const s of stocks) {
    const k = norm(s.material);
    materials.get(k)?.stocks.push(s);
  }

  const extraUnplaced: Unplaced[] = [];
  const work: { items: Item[]; ctx: GroupContext; area: number }[] = [];
  let key = 0;
  for (const [, g] of materials) {
    if (g.stocks.length === 0) {
      for (const p of g.parts)
        extraUnplaced.push({
          partId: p.id,
          name: p.name,
          count: p.qty,
          reason: `No stock sheets for material “${p.material || 'unspecified'}”`,
        });
      continue;
    }
    const items: Item[] = [];
    let area = 0;
    for (const p of g.parts) {
      for (let i = 0; i < p.qty; i++) {
        items.push({
          key: key++,
          partId: p.id,
          name: p.name,
          instance: i + 1,
          length: p.length,
          width: p.width,
          grain: p.grain,
          area: p.length * p.width,
        });
        area += p.length * p.width;
      }
    }
    work.push({
      items,
      area,
      ctx: {
        stocks: g.stocks,
        kerf: Math.max(0, settings.kerf),
        trim: Math.max(0, settings.trim),
        mode: settings.mode,
        useCost: g.stocks.some((s) => s.cost > 0),
        objective: settings.objective,
      },
    });
  }

  const totalBudget = BUDGET_MS[settings.effort] ?? BUDGET_MS.balanced;
  const totalArea = work.reduce((a, w) => a + w.area, 0) || 1;
  const done: { packing: Packing; ctx: GroupContext }[] = [];
  let evaluations = 0;
  let lastReport = 0;

  for (let gi = 0; gi < work.length; gi++) {
    const w = work[gi];
    const budget = Math.max(60, totalBudget * (w.area / totalArea));
    const res = searchGroup(w.items, w.ctx, budget, 0x9e3779b9 ^ gi, PATIENCE[settings.effort] ?? PATIENCE.balanced, (p, fraction) => {
      if (!onProgress) return;
      const now = performance.now();
      if (now - lastReport < 120) return;
      lastReport = now;
      const partial = [...done, { packing: p, ctx: w.ctx }];
      // Groups not yet searched are omitted from intermediate results.
      onProgress({
        solution: buildSolution(partial, extraUnplaced, project, now - start, evaluations),
        progress: (gi + fraction) / work.length,
      });
    });
    evaluations += res.evaluations;
    done.push({ packing: res.packing, ctx: res.ctx });
  }

  return buildSolution(done, extraUnplaced, project, performance.now() - start, evaluations);
}

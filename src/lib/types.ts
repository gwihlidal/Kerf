export type Units = 'mm' | 'in';
export type CutMode = 'guillotine' | 'nested';
export type Objective = 'waste' | 'cuts';
export type Effort = 'fast' | 'balanced' | 'thorough';

export interface Part {
  id: string;
  name: string;
  /** Dimension along the grain (when grain-locked). */
  length: number;
  width: number;
  qty: number;
  /** When true (and the stock has grain), the part's length must follow the sheet's grain. */
  grain: boolean;
  material: string;
  enabled: boolean;
}

export interface Stock {
  id: string;
  name: string;
  /** Dimension along the grain. */
  length: number;
  width: number;
  /** null = unlimited supply. */
  qty: number | null;
  cost: number;
  grain: boolean;
  material: string;
  enabled: boolean;
}

export interface Settings {
  units: Units;
  kerf: number;
  trim: number;
  mode: CutMode;
  objective: Objective;
  effort: Effort;
  /** Fraction denominator for inch display (0 = decimal). */
  precision: number;
  minOffcut: number;
  showCuts: boolean;
  showLabels: boolean;
}

export interface Project {
  name: string;
  parts: Part[];
  stock: Stock[];
  settings: Settings;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Placement extends Rect {
  partId: string;
  name: string;
  instance: number;
  rotated: boolean;
  /** Original part length/width for labelling. */
  length: number;
  width: number;
}

export interface Cut {
  dir: 'h' | 'v';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Size of the piece being cut (x-extent, y-extent). */
  pieceW: number;
  pieceH: number;
  /** Distance from the piece's leading edge to the cut (the fence setting). */
  offset: number;
  /** Index (within the sheet's cut list) of the cut that produced the piece being cut; -1 = full sheet. */
  parent: number;
  /** 1-based step in the project cutting plan (cuts sharing a step share a fence setting). */
  step: number;
}

/** One fence setting in the cutting plan, applied to every listed sheet before moving on. */
export interface PlanStep {
  step: number;
  material: string;
  dir: 'h' | 'v';
  offset: number;
  /** Total cuts in this step across all sheets. */
  count: number;
  /** Cuts per sheet (index into Solution.sheets). */
  sheets: { sheet: number; count: number }[];
}

export interface SheetResult {
  stockId: string;
  stockName: string;
  material: string;
  length: number;
  width: number;
  grain: boolean;
  trim: number;
  cost: number;
  placements: Placement[];
  cuts: Cut[];
  offcuts: Rect[];
  partArea: number;
}

export interface Unplaced {
  partId: string;
  name: string;
  count: number;
  reason: string;
}

export interface SolutionStats {
  sheetCount: number;
  stockArea: number;
  partArea: number;
  yield: number;
  cutCount: number;
  /** Number of distinct fence setups in the cutting plan. */
  setups: number;
  cutLength: number;
  cost: number;
  partCount: number;
  perStock: { stockId: string; name: string; material: string; count: number }[];
}

export interface Solution {
  sheets: SheetResult[];
  unplaced: Unplaced[];
  stats: SolutionStats;
  plan: PlanStep[];
  elapsedMs: number;
  evaluations: number;
  mode: CutMode;
}

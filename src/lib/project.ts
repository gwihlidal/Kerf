import type { Part, Project, Settings, Stock, Units } from './types';
import { convertValue } from './units';

export const uid = () => Math.random().toString(36).slice(2, 10);

const STORAGE_KEY = 'kerf.project.v1';

export function defaultUnits(): Units {
  const lang = typeof navigator !== 'undefined' ? navigator.language : 'en-US';
  return /^en-(US|LR|MM)$/i.test(lang) ? 'in' : 'mm';
}

export function defaultSettings(units: Units): Settings {
  return {
    units,
    kerf: units === 'in' ? 0.125 : 3.2,
    trim: 0,
    mode: 'guillotine',
    objective: 'waste',
    effort: 'balanced',
    precision: 16,
    minOffcut: units === 'in' ? 4 : 100,
    showCuts: true,
    showLabels: true,
  };
}

const p = (name: string, length: number, width: number, qty: number, material: string, grain = true): Part => ({
  id: uid(),
  name,
  length,
  width,
  qty,
  grain,
  material,
  enabled: true,
});

const s = (
  name: string,
  length: number,
  width: number,
  material: string,
  qty: number | null = null,
  cost = 0,
  grain = true,
): Stock => ({ id: uid(), name, length, width, qty, cost, grain, material, enabled: true });

export function sampleProject(units: Units): Project {
  if (units === 'in') {
    const A = '3/4" Birch Ply';
    const B = '1/4" Plywood';
    return {
      name: 'Bookcase with drawers',
      parts: [
        p('Side', 72, 14, 2, A),
        p('Top / Bottom', 32, 14, 2, A),
        p('Shelf', 30.5, 13.25, 5, A),
        p('Drawer front', 15, 6, 4, A),
        p('Drawer side', 13, 5, 8, A),
        p('Drawer back', 13.5, 4.5, 4, A),
        p('Back panel', 72, 32, 1, B),
        p('Drawer bottom', 13.5, 12.75, 4, B, false),
      ],
      stock: [s('4×8 sheet', 96, 48, A, null, 85), s('4×8 sheet', 96, 48, B, null, 45)],
      settings: defaultSettings('in'),
    };
  }
  const A = '18mm Birch Ply';
  const B = '6mm Plywood';
  return {
    name: 'Bookcase with drawers',
    parts: [
      p('Side', 1830, 356, 2, A),
      p('Top / Bottom', 813, 356, 2, A),
      p('Shelf', 775, 336, 5, A),
      p('Drawer front', 381, 152, 4, A),
      p('Drawer side', 330, 127, 8, A),
      p('Drawer back', 343, 114, 4, A),
      p('Back panel', 1830, 813, 1, B),
      p('Drawer bottom', 343, 324, 4, B, false),
    ],
    stock: [s('2440×1220 sheet', 2440, 1220, A, null, 95), s('2440×1220 sheet', 2440, 1220, B, null, 42)],
    settings: defaultSettings('mm'),
  };
}

export function emptyProject(units: Units): Project {
  const mat = units === 'in' ? '3/4" Plywood' : '18mm Plywood';
  return {
    name: 'Untitled project',
    parts: [p('Part 1', 0, 0, 1, mat)],
    stock: [units === 'in' ? s('4×8 sheet', 96, 48, mat) : s('2440×1220 sheet', 2440, 1220, mat)],
    settings: defaultSettings(units),
  };
}

export const STOCK_PRESETS: { label: string; in: [number, number]; mm: [number, number] }[] = [
  { label: '4×8 ft full sheet', in: [96, 48], mm: [2440, 1220] },
  { label: '4×4 ft half sheet', in: [48, 48], mm: [1220, 1220] },
  { label: '2×4 ft quarter sheet', in: [48, 24], mm: [1220, 610] },
  { label: '5×5 ft Baltic birch', in: [60, 60], mm: [1525, 1525] },
  { label: '5×10 ft oversize', in: [120, 60], mm: [3050, 1525] },
  { label: '2800×2070 board (EU)', in: [110.25, 81.5], mm: [2800, 2070] },
];

export function convertProject(project: Project, to: Units): Project {
  const from = project.settings.units;
  if (from === to) return project;
  const c = (v: number) => convertValue(v, from, to);
  return {
    ...project,
    parts: project.parts.map((x) => ({ ...x, length: c(x.length), width: c(x.width) })),
    stock: project.stock.map((x) => ({ ...x, length: c(x.length), width: c(x.width) })),
    settings: {
      ...project.settings,
      units: to,
      kerf: c(project.settings.kerf),
      trim: c(project.settings.trim),
      minOffcut: c(project.settings.minOffcut),
    },
  };
}

export function isProject(v: unknown): v is Project {
  const o = v as Project;
  return !!o && typeof o === 'object' && Array.isArray(o.parts) && Array.isArray(o.stock) && !!o.settings;
}

export function normalizeProject(raw: Project): Project {
  const units = raw.settings?.units === 'in' ? 'in' : 'mm';
  return {
    name: raw.name || 'Untitled project',
    parts: raw.parts.map((x) => ({
      id: x.id || uid(),
      name: x.name ?? '',
      length: +x.length || 0,
      width: +x.width || 0,
      qty: Math.max(0, Math.round(+x.qty || 0)),
      grain: !!x.grain,
      material: x.material ?? '',
      enabled: x.enabled !== false,
    })),
    stock: raw.stock.map((x) => ({
      id: x.id || uid(),
      name: x.name ?? '',
      length: +x.length || 0,
      width: +x.width || 0,
      qty: x.qty == null ? null : Math.max(0, Math.round(+x.qty)),
      cost: +x.cost || 0,
      grain: x.grain !== false,
      material: x.material ?? '',
      enabled: x.enabled !== false,
    })),
    settings: { ...defaultSettings(units), ...raw.settings, units },
  };
}

export function loadProject(): Project {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const v = JSON.parse(raw);
      if (isProject(v)) return normalizeProject(v);
    }
  } catch {
    /* ignore */
  }
  return sampleProject(defaultUnits());
}

export function saveProject(project: Project) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  } catch {
    /* ignore */
  }
}

/** Parse pasted CSV / TSV of parts: name, length, width, qty, [grain], [material]. */
export function parsePartsTable(
  text: string,
  units: Units,
  parse: (s: string, u: Units) => number | null,
  defaultMaterial: string,
): Part[] {
  const out: Part[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = (line.includes('\t') ? line.split('\t') : splitCsv(line)).map((c) => c.trim());
    if (cells.length < 2) continue;
    let [name, l, w, q, g, m] = cells;
    // Allow rows without a name: length, width, [qty]
    if (parse(name, units) != null && cells.length <= 3) {
      [l, w, q] = cells;
      name = `Part ${out.length + 1}`;
      g = '';
      m = '';
    }
    const length = parse(l ?? '', units);
    const width = parse(w ?? '', units);
    if (length == null || width == null) continue; // header row or garbage
    const qty = q ? Math.max(1, Math.round(parseFloat(q)) || 1) : 1;
    const grain = g ? /^(y|yes|true|1|x|grain)$/i.test(g) : true;
    out.push({ id: uid(), name, length, width, qty, grain, material: m || defaultMaterial, enabled: true });
  }
  return out;
}

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"' && cur.trim() === '') q = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export function partsToCsv(project: Project): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const rows = ['Name,Length,Width,Qty,Grain,Material'];
  for (const x of project.parts)
    rows.push([esc(x.name), x.length, x.width, x.qty, x.grain ? 'yes' : 'no', esc(x.material)].join(','));
  return rows.join('\n');
}

export function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const PALETTE = [
  '#4f8cff', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4',
  '#ec4899', '#84cc16', '#f97316', '#14b8a6', '#6366f1', '#eab308',
];

export function partColor(index: number) {
  return PALETTE[index % PALETTE.length];
}

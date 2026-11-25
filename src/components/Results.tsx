import { Fragment, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, DollarSign, Layers, ListOrdered, Loader2, Maximize2, Percent, Scissors, Sparkles, Trash, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Project, SheetResult, Solution } from '../lib/types';
import { formatArea, formatLength, formatRun } from '../lib/units';
import { SheetDiagram } from './SheetDiagram';
import type { OptimizerState } from '../lib/useOptimizer';

interface Props {
  project: Project;
  state: OptimizerState;
  colors: Map<string, string>;
  highlight: string | null;
  setHighlight: (id: string | null) => void;
}

interface SheetGroup {
  sheet: SheetResult;
  indices: number[];
}

function signature(s: SheetResult) {
  const r = (v: number) => Math.round(v * 100);
  return (
    s.stockId +
    '|' +
    s.placements
      .map((p) => `${p.partId}:${r(p.x)}:${r(p.y)}:${r(p.w)}:${r(p.h)}`)
      .sort()
      .join(';')
  );
}

function groupSheets(sol: Solution): SheetGroup[] {
  const groups: SheetGroup[] = [];
  const map = new Map<string, SheetGroup>();
  sol.sheets.forEach((s, i) => {
    const sig = signature(s);
    const g = map.get(sig);
    if (g) g.indices.push(i);
    else {
      const ng = { sheet: s, indices: [i] };
      map.set(sig, ng);
      groups.push(ng);
    }
  });
  return groups;
}

export function Results({ project, state, colors, highlight, setHighlight }: Props) {
  const { solution, running, progress, error } = state;
  const { units, precision, showCuts, showLabels } = project.settings;
  const [zoom, setZoom] = useState<SheetGroup | null>(null);
  const [activeStep, setActiveStep] = useState<number | null>(null);
  const groups = useMemo(() => (solution ? groupSheets(solution) : []), [solution]);
  const hasCost = project.stock.some((s) => s.cost > 0);

  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setZoom(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoom]);

  const activeParts = project.parts.filter((p) => p.enabled && p.qty > 0 && p.length > 0 && p.width > 0);

  if (activeParts.length === 0) {
    return (
      <div className="results-empty">
        <div className="empty-illustration">
          <Layers size={40} />
        </div>
        <h3>Add some parts to get started</h3>
        <p>Enter the panels you need on the left. Layouts update live as you type.</p>
      </div>
    );
  }

  const st = solution?.stats;
  const waste = st ? st.stockArea - st.partArea : 0;

  return (
    <div className="results">
      <div className={`progress-strip ${running ? 'on' : ''}`}>
        <div className="progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>

      <div className="results-head">
        <div>
          <h1 className="print-title">{project.name}</h1>
          <div className="status-line">
            {running ? (
              <>
                <Loader2 size={14} className="spin" /> Optimizing…
              </>
            ) : error ? (
              <span className="warn-text">Optimizer error: {error}</span>
            ) : solution ? (
              <>
                <Sparkles size={14} /> Best of {solution.evaluations.toLocaleString()} layouts in {(solution.elapsedMs / 1000).toFixed(1)}s ·{' '}
                {solution.mode === 'guillotine' ? 'table-saw cuts' : 'CNC nesting'}
              </>
            ) : null}
          </div>
        </div>
      </div>

      {st && (
        <div className="stats">
          <Stat icon={<Layers size={18} />} label="Sheets" value={String(st.sheetCount)}>
            {st.perStock.map((p) => (
              <div key={p.stockId} className="stat-sub">
                {p.count}× {p.name}
                {p.material ? <span className="muted"> · {p.material}</span> : null}
              </div>
            ))}
          </Stat>
          <Stat icon={<Percent size={18} />} label="Material yield" value={`${(st.yield * 100).toFixed(1)}%`} accent>
            <div className="yield-bar">
              <div style={{ width: `${st.yield * 100}%` }} />
            </div>
            <div className="stat-sub">
              {formatArea(st.partArea, units)} of {formatArea(st.stockArea, units)}
            </div>
          </Stat>
          <Stat icon={<Trash size={18} />} label="Waste" value={formatArea(waste, units)}>
            <div className="stat-sub">{st.stockArea ? ((waste / st.stockArea) * 100).toFixed(1) : 0}% incl. kerf &amp; offcuts</div>
          </Stat>
          {solution!.mode === 'guillotine' ? (
            <Stat icon={<Scissors size={18} />} label="Cuts" value={String(st.cutCount)}>
              <div className="stat-sub">
                <strong>{st.setups}</strong> fence setups
              </div>
              <div className="stat-sub">{formatRun(st.cutLength, units)} total cut length</div>
            </Stat>
          ) : (
            <Stat icon={<Scissors size={18} />} label="Parts" value={String(st.partCount)}>
              <div className="stat-sub">nested for CNC</div>
            </Stat>
          )}
          {hasCost && (
            <Stat icon={<DollarSign size={18} />} label="Material cost" value={`$${st.cost.toFixed(2)}`}>
              <div className="stat-sub">${st.partCount ? (st.cost / st.partCount).toFixed(2) : '0'} per part</div>
            </Stat>
          )}
        </div>
      )}

      {solution && solution.unplaced.length > 0 && (
        <div className="alert">
          <AlertTriangle size={18} />
          <div>
            <strong>Some parts could not be placed</strong>
            <ul>
              {solution.unplaced.map((u) => (
                <li key={u.partId + u.reason}>
                  {u.count}× {u.name || 'Unnamed part'} — {u.reason}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="sheets">
        {groups.map((g) => (
          <SheetCard
            key={g.indices[0] + signature(g.sheet)}
            group={g}
            project={project}
            colors={colors}
            highlight={highlight}
            setHighlight={setHighlight}
            onZoom={() => setZoom(g)}
            showCuts={showCuts}
            showLabels={showLabels}
            activeStep={activeStep}
            setActiveStep={setActiveStep}
          />
        ))}
        {!solution && (
          <div className="sheet-card skeleton">
            <div className="skeleton-box" />
          </div>
        )}
      </div>

      {solution && solution.plan.length > 0 && (
        <CutPlan solution={solution} project={project} activeStep={activeStep} setActiveStep={setActiveStep} />
      )}

      {zoom && (
        <div className="modal-backdrop" onClick={() => setZoom(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <div>
                <h3>{sheetTitle(zoom)}</h3>
                <div className="muted">
                  {zoom.sheet.stockName} · {formatLength(zoom.sheet.length, units, precision)} × {formatLength(zoom.sheet.width, units, precision)}
                  {units === 'in' ? '″' : ' mm'}
                  {zoom.sheet.material ? ` · ${zoom.sheet.material}` : ''}
                </div>
              </div>
              <button className="icon-btn" onClick={() => setZoom(null)} aria-label="Close">
                <X size={18} />
              </button>
            </header>
            <div className="modal-body">
              <div className="modal-diagram">
                <SheetDiagram
                  sheet={zoom.sheet}
                  colors={colors}
                  units={units}
                  precision={precision}
                  showCuts={showCuts}
                  showLabels={showLabels}
                  showCutNumbers={showCuts}
                  highlight={highlight}
                  onHover={setHighlight}
                  activeStep={activeStep}
                />
              </div>
              <aside className="modal-side">
                <PartsLegend sheet={zoom.sheet} colors={colors} project={project} />
                {zoom.sheet.cuts.length > 0 && (
                  <CutSequence sheet={zoom.sheet} project={project} activeStep={activeStep} setActiveStep={setActiveStep} />
                )}
                <OffcutList sheet={zoom.sheet} project={project} />
              </aside>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function sheetTitle(g: SheetGroup) {
  const first = g.indices[0] + 1;
  if (g.indices.length === 1) return `Sheet ${first}`;
  const contiguous = g.indices.every((v, i) => i === 0 || v === g.indices[i - 1] + 1);
  return contiguous ? `Sheets ${first}–${g.indices[g.indices.length - 1] + 1}` : `Sheets ${g.indices.map((i) => i + 1).join(', ')}`;
}

function Stat({ icon, label, value, children, accent }: { icon: ReactNode; label: string; value: string; children?: ReactNode; accent?: boolean }) {
  return (
    <div className={`stat ${accent ? 'accent' : ''}`}>
      <div className="stat-label">
        {icon}
        {label}
      </div>
      <div className="stat-value">{value}</div>
      {children}
    </div>
  );
}

function SheetCard({
  group,
  project,
  colors,
  highlight,
  setHighlight,
  onZoom,
  showCuts,
  showLabels,
  activeStep,
  setActiveStep,
}: {
  group: SheetGroup;
  project: Project;
  colors: Map<string, string>;
  highlight: string | null;
  setHighlight: (id: string | null) => void;
  onZoom: () => void;
  showCuts: boolean;
  showLabels: boolean;
  activeStep: number | null;
  setActiveStep: (s: number | null) => void;
}) {
  const { units, precision } = project.settings;
  const s = group.sheet;
  const util = s.partArea / (s.length * s.width);
  const [open, setOpen] = useState(false);
  return (
    <article className="sheet-card">
      <header className="sheet-head">
        <div className="sheet-title">
          <h3>{sheetTitle(group)}</h3>
          {group.indices.length > 1 && <span className="badge strong">×{group.indices.length}</span>}
          <span className="muted">
            {s.stockName} · {formatLength(s.length, units, precision)} × {formatLength(s.width, units, precision)}
            {units === 'in' ? '″' : ' mm'}
          </span>
          {s.material && <span className="chip">{s.material}</span>}
        </div>
        <div className="sheet-meta">
          <span className={`util ${util > 0.8 ? 'good' : util > 0.55 ? 'ok' : 'low'}`}>{(util * 100).toFixed(1)}% used</span>
          <button className="icon-btn" onClick={onZoom} title="Open large view with numbered cuts">
            <Maximize2 size={16} />
          </button>
        </div>
      </header>
      <div className="sheet-body" onClick={onZoom}>
        <SheetDiagram
          sheet={s}
          colors={colors}
          units={units}
          precision={precision}
          showCuts={showCuts}
          showLabels={showLabels}
          highlight={highlight}
          onHover={setHighlight}
          activeStep={activeStep}
        />
      </div>
      <PartsLegend sheet={s} colors={colors} project={project} compact />
      {s.cuts.length > 0 && (
        <div className={`collapsible ${open ? 'open' : ''}`}>
          <button className="collapsible-head" onClick={() => setOpen((v) => !v)}>
            <ChevronDown size={16} /> Cut sequence{' '}
            <span className="muted">
              ({s.cuts.length} cuts · {new Set(s.cuts.map((c) => c.step)).size} setups)
            </span>
          </button>
          {open && <CutSequence sheet={s} project={project} activeStep={activeStep} setActiveStep={setActiveStep} />}
        </div>
      )}
    </article>
  );
}

function PartsLegend({ sheet, colors, project, compact }: { sheet: SheetResult; colors: Map<string, string>; project: Project; compact?: boolean }) {
  const { units, precision } = project.settings;
  const counts = new Map<string, { name: string; count: number; l: number; w: number }>();
  for (const p of sheet.placements) {
    const c = counts.get(p.partId);
    if (c) c.count++;
    else counts.set(p.partId, { name: p.name, count: 1, l: p.length, w: p.width });
  }
  return (
    <div className={`legend ${compact ? 'compact' : ''}`}>
      {[...counts.entries()].map(([id, c]) => (
        <span key={id} className="legend-item">
          <span className="legend-dot" style={{ background: colors.get(id) }} />
          <span className="legend-name">{c.name || 'Part'}</span>
          <span className="muted">
            {formatLength(c.l, units, precision)} × {formatLength(c.w, units, precision)}
          </span>
          <span className="legend-count">×{c.count}</span>
        </span>
      ))}
    </div>
  );
}

function CutSequence({
  sheet,
  project,
  activeStep,
  setActiveStep,
}: {
  sheet: SheetResult;
  project: Project;
  activeStep: number | null;
  setActiveStep: (s: number | null) => void;
}) {
  const { units, precision } = project.settings;
  const f = (v: number) => formatLength(v, units, precision);
  const u = units === 'in' ? '″' : ' mm';
  // Group consecutive cuts that share a plan step (one fence setting).
  const groups: { step: number; items: { c: (typeof sheet.cuts)[number]; i: number }[] }[] = [];
  sheet.cuts.forEach((c, i) => {
    const last = groups[groups.length - 1];
    if (last && last.step === c.step) last.items.push({ c, i });
    else groups.push({ step: c.step, items: [{ c, i }] });
  });
  return (
    <div className="cut-groups">
      {groups.map((g) => {
        const first = g.items[0].c;
        return (
          <div
            key={g.step + ':' + g.items[0].i}
            className={`cut-group ${activeStep === g.step ? 'active' : ''}`}
            onMouseEnter={() => setActiveStep(g.step)}
            onMouseLeave={() => setActiveStep(null)}
          >
            <div className="cut-group-head">
              <span className="step-num">Step {g.step}</span>
              <span className={`cut-kind ${first.dir === 'h' ? 'rip' : 'cross'}`}>{first.dir === 'h' ? 'Rip' : 'Crosscut'}</span>
              <span>
                fence at <strong>{f(first.offset)}{u}</strong>
              </span>
              {g.items.length > 1 && <span className="muted">· {g.items.length} cuts</span>}
            </div>
            <ol className="cut-list">
              {g.items.map(({ c, i }) => (
                <li key={i}>
                  <span className="cut-num">{i + 1}</span>
                  <span className="muted">
                    {f(c.pieceW)} × {f(c.pieceH)} piece
                  </span>
                </li>
              ))}
            </ol>
          </div>
        );
      })}
    </div>
  );
}

function CutPlan({
  solution,
  project,
  activeStep,
  setActiveStep,
}: {
  solution: Solution;
  project: Project;
  activeStep: number | null;
  setActiveStep: (s: number | null) => void;
}) {
  const { units, precision } = project.settings;
  const [open, setOpen] = useState(true);
  const f = (v: number) => formatLength(v, units, precision);
  const u = units === 'in' ? '″' : ' mm';
  const multiMaterial = new Set(solution.plan.map((p) => p.material.trim().toLowerCase())).size > 1;
  return (
    <section className={`plan-card collapsible ${open ? 'open' : ''}`}>
      <button className="collapsible-head plan-head" onClick={() => setOpen((v) => !v)}>
        <ChevronDown size={16} />
        <ListOrdered size={18} />
        <span className="plan-title">Cutting plan</span>
        <span className="muted">
          {solution.stats.setups} fence setups for {solution.stats.cutCount} cuts
        </span>
      </button>
      {open && (
        <>
          <p className="hint plan-hint">
            Set the fence once per step and make every listed cut, on every listed sheet, before moving on. Identical
            strips are batched together. Hover a step to see its cuts on the diagrams.
          </p>
          <ol className="plan-list">
            {solution.plan.map((p, i) => {
              const header = multiMaterial && (i === 0 || solution.plan[i - 1].material !== p.material);
              return (
                <Fragment key={p.step}>
                  {header && <li className="plan-material">{p.material}</li>}
                  <li
                    className={`plan-step ${activeStep === p.step ? 'active' : ''}`}
                    onMouseEnter={() => setActiveStep(p.step)}
                    onMouseLeave={() => setActiveStep(null)}
                  >
                    <span className="step-badge">{p.step}</span>
                    <span className={`cut-kind ${p.dir === 'h' ? 'rip' : 'cross'}`}>{p.dir === 'h' ? 'Rip' : 'Crosscut'}</span>
                    <span className="plan-setting">
                      {f(p.offset)}
                      {u}
                    </span>
                    <span className="plan-count">
                      {p.count} cut{p.count === 1 ? '' : 's'}
                    </span>
                    <span className="plan-sheets">
                      {p.sheets.map((s) => (
                        <span key={s.sheet} className="sheet-chip">
                          Sheet {s.sheet + 1}
                          {s.count > 1 ? <span className="muted"> ×{s.count}</span> : null}
                        </span>
                      ))}
                    </span>
                  </li>
                </Fragment>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}

function OffcutList({ sheet, project }: { sheet: SheetResult; project: Project }) {
  const { units, precision } = project.settings;
  if (sheet.offcuts.length === 0) return null;
  const f = (v: number) => formatLength(v, units, precision);
  return (
    <div className="offcut-list">
      <h4>Usable offcuts</h4>
      {sheet.offcuts.slice(0, 8).map((o, i) => (
        <div key={i} className="offcut-row">
          {f(o.w)} × {f(o.h)}
          {units === 'in' ? '″' : ' mm'}
        </div>
      ))}
    </div>
  );
}

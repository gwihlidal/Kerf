import { useMemo, useState } from 'react';
import { ClipboardPaste, Copy, Eye, EyeOff, Infinity as InfinityIcon, Layers, Plus, Settings2, Trash2, Boxes } from 'lucide-react';
import type { Part, Project, Settings, Stock } from '../lib/types';
import { parsePartsTable, partColor, STOCK_PRESETS, uid } from '../lib/project';
import { parseLength, formatLength } from '../lib/units';
import { DimInput, GrainIcon, NumInput, Segmented, Toggle } from './Inputs';

interface EditorProps {
  project: Project;
  update: (fn: (p: Project) => Project) => void;
  highlight: string | null;
  setHighlight: (id: string | null) => void;
}

function useMaterials(project: Project) {
  return useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of project.stock) if (s.material.trim()) seen.set(s.material.trim().toLowerCase(), s.material.trim());
    return [...seen.values()];
  }, [project.stock]);
}

/* ------------------------------------------------------------------ */

export function PartsPanel({ project, update, highlight, setHighlight }: EditorProps) {
  const { units, precision } = project.settings;
  const materials = useMaterials(project);
  const [newId, setNewId] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const showMaterial =
    materials.length > 1 || project.parts.some((p) => !materials.some((m) => m.toLowerCase() === p.material.trim().toLowerCase()));

  const setPart = (id: string, patch: Partial<Part>) =>
    update((p) => ({ ...p, parts: p.parts.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));

  const addPart = (after?: Part) => {
    const id = uid();
    const template = after ?? project.parts[project.parts.length - 1];
    const part: Part = {
      id,
      name: `Part ${project.parts.length + 1}`,
      length: 0,
      width: 0,
      qty: 1,
      grain: template?.grain ?? true,
      material: template?.material ?? materials[0] ?? '',
      enabled: true,
    };
    setNewId(id);
    update((p) => ({ ...p, parts: [...p.parts, part] }));
  };

  const totalQty = project.parts.reduce((a, p) => a + (p.enabled ? p.qty : 0), 0);

  return (
    <section className="card">
      <header className="card-head">
        <div className="card-title">
          <Boxes size={18} />
          <h2>Parts</h2>
          <span className="badge">{totalQty} pcs</span>
        </div>
        <div className="card-actions">
          <button className="btn ghost sm" onClick={() => setPasteOpen((v) => !v)} title="Paste from spreadsheet / CSV">
            <ClipboardPaste size={15} /> Paste
          </button>
          <button className="btn primary sm" onClick={() => addPart()}>
            <Plus size={15} /> Add
          </button>
        </div>
      </header>

      {pasteOpen && (
        <PasteBox
          onCancel={() => setPasteOpen(false)}
          onImport={(text, replace) => {
            const parts = parsePartsTable(text, units, parseLength, materials[0] ?? '');
            if (parts.length) update((p) => ({ ...p, parts: replace ? parts : [...p.parts, ...parts] }));
            setPasteOpen(false);
          }}
        />
      )}

      <div className={`grid-table parts ${showMaterial ? 'with-material' : ''}`}>
        <div className="grid-row head">
          <span />
          <span>Name</span>
          <span>Length</span>
          <span>Width</span>
          <span>Qty</span>
          <span title="Grain direction locked" className="head-icon"><GrainIcon size={14} /></span>
          {showMaterial && <span>Material</span>}
          <span />
        </div>
        {project.parts.map((part, i) => {
          const invalid = part.enabled && (part.length <= 0 || part.width <= 0);
          return (
            <div
              key={part.id}
              className={`grid-row ${!part.enabled ? 'disabled' : ''} ${highlight === part.id ? 'hl' : ''} ${invalid ? 'warn' : ''}`}
              onMouseEnter={() => setHighlight(part.id)}
              onMouseLeave={() => setHighlight(null)}
            >
              <button
                className="swatch"
                style={{ background: part.enabled ? partColor(i) : 'transparent', borderColor: partColor(i) }}
                title={part.enabled ? 'Exclude from optimization' : 'Include in optimization'}
                onClick={() => setPart(part.id, { enabled: !part.enabled })}
              >
                {part.enabled ? null : <EyeOff size={10} />}
              </button>
              <input
                className="input"
                value={part.name}
                aria-label="Part name"
                autoFocus={part.id === newId}
                onFocus={(e) => part.id === newId && e.target.select()}
                onChange={(e) => setPart(part.id, { name: e.target.value })}
              />
              <DimInput value={part.length} units={units} precision={precision} ariaLabel="Length" onChange={(v) => setPart(part.id, { length: v })} />
              <DimInput value={part.width} units={units} precision={precision} ariaLabel="Width" onChange={(v) => setPart(part.id, { width: v })} />
              <NumInput value={part.qty} integer min={0} ariaLabel="Quantity" onChange={(v) => setPart(part.id, { qty: v ?? 0 })} />
              <button
                className={`icon-toggle ${part.grain ? 'on' : ''}`}
                title={part.grain ? 'Grain locked: length follows the sheet grain' : 'Free rotation'}
                aria-pressed={part.grain}
                onClick={() => setPart(part.id, { grain: !part.grain })}
              >
                <GrainIcon size={15} />
              </button>
              {showMaterial && (
                <select
                  className="input select"
                  value={part.material}
                  aria-label="Material"
                  onChange={(e) => setPart(part.id, { material: e.target.value })}
                >
                  {!materials.some((m) => m === part.material) && <option value={part.material}>{part.material || '—'}</option>}
                  {materials.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              )}
              <div className="row-actions">
                <button
                  className="icon-btn"
                  title="Duplicate"
                  onClick={() =>
                    update((p) => {
                      const idx = p.parts.findIndex((x) => x.id === part.id);
                      const copy = { ...part, id: uid(), name: part.name + ' copy' };
                      return { ...p, parts: [...p.parts.slice(0, idx + 1), copy, ...p.parts.slice(idx + 1)] };
                    })
                  }
                >
                  <Copy size={14} />
                </button>
                <button
                  className="icon-btn danger"
                  title="Delete"
                  onClick={() => update((p) => ({ ...p, parts: p.parts.filter((x) => x.id !== part.id) }))}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
        {project.parts.length === 0 && (
          <div className="empty-row">
            No parts yet. <button className="link" onClick={() => addPart()}>Add your first part</button> or paste a list from a spreadsheet.
          </div>
        )}
      </div>
      <p className="hint">
        Type <kbd>23 1/2</kbd>, <kbd>4'6"</kbd>, <kbd>600mm</kbd> or <kbd>10 + 3/4</kbd> — units convert automatically.
      </p>
    </section>
  );
}

function PasteBox({ onImport, onCancel }: { onImport: (text: string, replace: boolean) => void; onCancel: () => void }) {
  const [text, setText] = useState('');
  return (
    <div className="paste-box">
      <textarea
        className="input"
        autoFocus
        rows={5}
        placeholder={'Paste rows from Excel / Sheets or CSV:\nName, Length, Width, Qty, Grain (yes/no), Material\nSide, 72, 14, 2, yes'}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="paste-actions">
        <button className="btn ghost sm" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn sm" disabled={!text.trim()} onClick={() => onImport(text, true)}>
          Replace all
        </button>
        <button className="btn primary sm" disabled={!text.trim()} onClick={() => onImport(text, false)}>
          Append
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function StockPanel({ project, update }: EditorProps) {
  const { units, precision } = project.settings;
  const materials = useMaterials(project);
  const usedMaterials = useMemo(() => [...new Set(project.parts.map((p) => p.material.trim()).filter(Boolean))], [project.parts]);

  const setStock = (id: string, patch: Partial<Stock>) =>
    update((p) => {
      const prev = p.stock.find((s) => s.id === id);
      let parts = p.parts;
      // Renaming a material carries over to parts using it (if no other stock shares the old name).
      if (prev && patch.material != null && prev.material !== patch.material) {
        const others = p.stock.some((s) => s.id !== id && s.material === prev.material);
        if (!others) parts = parts.map((x) => (x.material === prev.material ? { ...x, material: patch.material! } : x));
      }
      return { ...p, parts, stock: p.stock.map((x) => (x.id === id ? { ...x, ...patch } : x)) };
    });

  const addStock = (preset?: (typeof STOCK_PRESETS)[number]) => {
    const [l, w] = preset ? preset[units] : units === 'in' ? [96, 48] : [2440, 1220];
    const last = project.stock[project.stock.length - 1];
    const material = last?.material ?? usedMaterials[0] ?? '';
    update((p) => ({
      ...p,
      stock: [
        ...p.stock,
        {
          id: uid(),
          name: preset ? preset.label : `${formatLength(l, units, precision)}×${formatLength(w, units, precision)} sheet`,
          length: l,
          width: w,
          qty: null,
          cost: 0,
          grain: true,
          material,
          enabled: true,
        },
      ],
    }));
  };

  return (
    <section className="card">
      <header className="card-head">
        <div className="card-title">
          <Layers size={18} />
          <h2>Stock sheets</h2>
          <span className="badge">{project.stock.length}</span>
        </div>
        <div className="card-actions">
          <select
            className="input select sm"
            value=""
            onChange={(e) => {
              const preset = STOCK_PRESETS.find((p) => p.label === e.target.value);
              if (preset) addStock(preset);
            }}
            aria-label="Add from preset"
          >
            <option value="">Presets…</option>
            {STOCK_PRESETS.map((p) => (
              <option key={p.label} value={p.label}>
                {p.label} ({formatLength(p[units][0], units, precision)} × {formatLength(p[units][1], units, precision)})
              </option>
            ))}
          </select>
          <button className="btn primary sm" onClick={() => addStock()}>
            <Plus size={15} /> Add
          </button>
        </div>
      </header>

      <datalist id="materials-list">
        {[...new Set([...materials, ...usedMaterials])].map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>

      <div className="stock-list">
        {project.stock.map((s) => (
          <div key={s.id} className={`stock-item ${!s.enabled ? 'disabled' : ''}`}>
            <div className="stock-line">
              <input className="input grow" value={s.name} aria-label="Stock name" onChange={(e) => setStock(s.id, { name: e.target.value })} />
              <input
                className="input material"
                value={s.material}
                list="materials-list"
                placeholder="Material"
                aria-label="Material"
                onChange={(e) => setStock(s.id, { material: e.target.value })}
              />
              <button className="icon-btn" title={s.enabled ? 'Disable' : 'Enable'} onClick={() => setStock(s.id, { enabled: !s.enabled })}>
                {s.enabled ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
              <button
                className="icon-btn danger"
                title="Delete"
                onClick={() => update((p) => ({ ...p, stock: p.stock.filter((x) => x.id !== s.id) }))}
              >
                <Trash2 size={14} />
              </button>
            </div>
            <div className="stock-line">
              <label className="field-inline">
                <span>L</span>
                <DimInput value={s.length} units={units} precision={precision} ariaLabel="Length" onChange={(v) => setStock(s.id, { length: v })} />
              </label>
              <span className="times">×</span>
              <label className="field-inline">
                <span>W</span>
                <DimInput value={s.width} units={units} precision={precision} ariaLabel="Width" onChange={(v) => setStock(s.id, { width: v })} />
              </label>
              <label className="field-inline qty" title="Leave empty for unlimited">
                <span>Qty</span>
                <NumInput value={s.qty} allowNull integer placeholder="∞" ariaLabel="Quantity" onChange={(v) => setStock(s.id, { qty: v })} />
                {s.qty == null && <InfinityIcon size={12} className="inf-hint" />}
              </label>
              <label className="field-inline cost" title="Price per sheet (0 = already owned)">
                <NumInput value={s.cost || null} allowNull prefix="$" placeholder="0" ariaLabel="Cost" onChange={(v) => setStock(s.id, { cost: v ?? 0 })} />
              </label>
              <button
                className={`icon-toggle ${s.grain ? 'on' : ''}`}
                title={s.grain ? 'Sheet has grain along its length' : 'No grain (MDF, melamine…)'}
                aria-pressed={s.grain}
                onClick={() => setStock(s.id, { grain: !s.grain })}
              >
                <GrainIcon size={15} />
              </button>
            </div>
          </div>
        ))}
        {project.stock.length === 0 && <div className="empty-row">Add at least one stock sheet.</div>}
      </div>
      {usedMaterials.some((m) => !materials.some((x) => x.toLowerCase() === m.toLowerCase())) && (
        <p className="hint warn-text">
          Some parts use a material with no stock sheet:{' '}
          {usedMaterials.filter((m) => !materials.some((x) => x.toLowerCase() === m.toLowerCase())).join(', ')}
        </p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */

export function SettingsPanel({ project, update }: EditorProps) {
  const s = project.settings;
  const set = (patch: Partial<Settings>) => update((p) => ({ ...p, settings: { ...p.settings, ...patch } }));
  return (
    <section className="card">
      <header className="card-head">
        <div className="card-title">
          <Settings2 size={18} />
          <h2>Settings</h2>
        </div>
      </header>
      <div className="settings-grid">
        <label className="field">
          <span>Blade kerf</span>
          <DimInput value={s.kerf} units={s.units} precision={Math.max(s.precision, 32)} onChange={(v) => set({ kerf: v })} placeholder="0" />
        </label>
        <label className="field">
          <span>Edge trim</span>
          <DimInput value={s.trim} units={s.units} precision={Math.max(s.precision, 32)} onChange={(v) => set({ trim: v })} placeholder="0" />
        </label>
        <label className="field">
          <span>Min. offcut</span>
          <DimInput value={s.minOffcut} units={s.units} precision={s.precision} onChange={(v) => set({ minOffcut: v })} placeholder="0" />
        </label>

        <div className="field span-3">
          <span>Cutting method</span>
          <Segmented
            value={s.mode}
            onChange={(mode) => set({ mode })}
            options={[
              { value: 'guillotine', label: 'Table / panel saw', title: 'Straight edge-to-edge cuts (guillotine)' },
              { value: 'nested', label: 'CNC / free-form', title: 'Free placement; densest packing, no cut sequence' },
            ]}
          />
        </div>
        <div className="field span-3">
          <span>Optimize for</span>
          <Segmented
            value={s.objective}
            onChange={(objective) => set({ objective })}
            options={[
              { value: 'waste', label: 'Least waste' },
              { value: 'cuts', label: 'Fastest cutting', title: 'Fewest cuts and fence changes' },
            ]}
          />
        </div>
        <div className="field span-3">
          <span>Search effort</span>
          <Segmented
            value={s.effort}
            onChange={(effort) => set({ effort })}
            options={[
              { value: 'fast', label: 'Fast' },
              { value: 'balanced', label: 'Balanced' },
              { value: 'thorough', label: 'Thorough' },
            ]}
          />
        </div>
        {s.units === 'in' && (
          <div className="field span-3">
            <span>Fraction precision</span>
            <Segmented
              value={String(s.precision)}
              onChange={(v) => set({ precision: parseInt(v, 10) })}
              options={[
                { value: '8', label: '1/8' },
                { value: '16', label: '1/16' },
                { value: '32', label: '1/32' },
                { value: '0', label: 'Decimal' },
              ]}
            />
          </div>
        )}
        <div className="span-3 toggles">
          <Toggle checked={s.showLabels} onChange={(v) => set({ showLabels: v })} label="Part labels" />
          <Toggle checked={s.showCuts} onChange={(v) => set({ showCuts: v })} label="Cut lines" />
        </div>
      </div>
    </section>
  );
}

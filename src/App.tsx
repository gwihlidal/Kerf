import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Download, FilePlus2, FileSpreadsheet, FolderOpen, Moon, Printer, Sparkles, Sun } from 'lucide-react';
import type { Project, Units } from './lib/types';
import {
  convertProject,
  download,
  emptyProject,
  isProject,
  loadProject,
  normalizeProject,
  partColor,
  partsToCsv,
  sampleProject,
  saveProject,
} from './lib/project';
import { useOptimizer } from './lib/useOptimizer';
import { PartsPanel, SettingsPanel, StockPanel } from './components/Editors';
import { Results } from './components/Results';
import { Segmented } from './components/Inputs';

type Theme = 'light' | 'dark';

function initialTheme(): Theme {
  const saved = localStorage.getItem('kerf.theme');
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export default function App() {
  const [project, setProject] = useState<Project>(loadProject);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [highlight, setHighlight] = useState<string | null>(null);
  const state = useOptimizer(project);

  useEffect(() => {
    const t = setTimeout(() => saveProject(project), 250);
    return () => clearTimeout(t);
  }, [project]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('kerf.theme', theme);
  }, [theme]);

  useEffect(() => {
    document.title = `${project.name} · Kerf`;
  }, [project.name]);

  const colors = useMemo(() => {
    const m = new Map<string, string>();
    project.parts.forEach((p, i) => m.set(p.id, partColor(i)));
    return m;
  }, [project.parts]);

  const update = (fn: (p: Project) => Project) => setProject(fn);
  const units = project.settings.units;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Logo />
          <span className="brand-name">Kerf</span>
        </div>
        <input
          className="project-name"
          value={project.name}
          onChange={(e) => update((p) => ({ ...p, name: e.target.value }))}
          aria-label="Project name"
        />
        <div className="topbar-spacer" />
        <Segmented<Units>
          size="sm"
          value={units}
          onChange={(u) => update((p) => convertProject(p, u))}
          options={[
            { value: 'in', label: 'in' },
            { value: 'mm', label: 'mm' },
          ]}
        />
        <FileMenu project={project} setProject={setProject} />
        <button className="btn ghost" onClick={() => window.print()} title="Print or save as PDF">
          <Printer size={16} /> <span className="hide-sm">Print</span>
        </button>
        <button
          className="icon-btn"
          onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          title="Toggle theme"
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <PartsPanel project={project} update={update} highlight={highlight} setHighlight={setHighlight} />
          <StockPanel project={project} update={update} highlight={highlight} setHighlight={setHighlight} />
          <SettingsPanel project={project} update={update} highlight={highlight} setHighlight={setHighlight} />
        </aside>
        <main className="main">
          <Results project={project} state={state} colors={colors} highlight={highlight} setHighlight={setHighlight} />
        </main>
      </div>
    </div>
  );
}

function FileMenu({ project, setProject }: { project: Project; setProject: (p: Project) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const slug = project.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'project';
  const act = (fn: () => void) => () => {
    fn();
    setOpen(false);
  };

  return (
    <div className="menu" ref={ref}>
      <button className="btn ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <FolderOpen size={16} /> <span className="hide-sm">Project</span> <ChevronDown size={14} />
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          <button
            onClick={act(() => {
              if (confirm('Start a new project? The current project will be replaced.')) setProject(emptyProject(project.settings.units));
            })}
          >
            <FilePlus2 size={16} /> New project
          </button>
          <button
            onClick={act(() => {
              if (confirm('Load the sample project? The current project will be replaced.')) setProject(sampleProject(project.settings.units));
            })}
          >
            <Sparkles size={16} /> Load sample project
          </button>
          <div className="menu-sep" />
          <button onClick={act(() => fileRef.current?.click())}>
            <FolderOpen size={16} /> Open project file…
          </button>
          <button onClick={act(() => download(`${slug}.kerf.json`, JSON.stringify(project, null, 2), 'application/json'))}>
            <Download size={16} /> Save project file
          </button>
          <button onClick={act(() => download(`${slug}-parts.csv`, partsToCsv(project), 'text/csv'))}>
            <FileSpreadsheet size={16} /> Export parts as CSV
          </button>
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          try {
            const data = JSON.parse(await file.text());
            if (!isProject(data)) throw new Error('Not a project file');
            setProject(normalizeProject(data));
          } catch (err) {
            alert(`Could not open file: ${(err as Error).message}`);
          }
        }}
      />
    </div>
  );
}

function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--accent-2)" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="28" height="28" rx="7" fill="url(#lg)" />
      <rect x="7" y="7" width="10" height="18" rx="1.5" fill="#fff" opacity="0.95" />
      <rect x="19" y="7" width="6" height="8" rx="1.5" fill="#fff" opacity="0.8" />
      <rect x="19" y="17" width="6" height="8" rx="1.5" fill="#fff" opacity="0.6" />
    </svg>
  );
}

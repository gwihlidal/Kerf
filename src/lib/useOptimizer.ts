import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Project, Solution } from './types';
import type { WorkerResponse } from './optimizer.worker';

export interface OptimizerState {
  solution: Solution | null;
  running: boolean;
  progress: number;
  error: string | null;
}

/** Runs the optimizer in a Web Worker, debounced and cancellable, whenever inputs change. */
export function useOptimizer(project: Project): OptimizerState {
  const [state, setState] = useState<OptimizerState>({ solution: null, running: false, progress: 0, error: null });
  const workerRef = useRef<Worker | null>(null);
  const idRef = useRef(0);

  // Only re-run when inputs that affect the layout change (not display-only settings).
  const key = useMemo(() => {
    const { parts, stock, settings } = project;
    return JSON.stringify({
      parts: parts.map(({ id, name, length, width, qty, grain, material, enabled }) => [id, name, length, width, qty, grain, material, enabled]),
      stock,
      s: [settings.kerf, settings.trim, settings.mode, settings.objective, settings.effort, settings.minOffcut, settings.units],
    });
  }, [project]);

  const projectRef = useRef(project);
  useLayoutEffect(() => {
    projectRef.current = project;
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      workerRef.current?.terminate();
      const worker = new Worker(new URL('./optimizer.worker.ts', import.meta.url), { type: 'module' });
      workerRef.current = worker;
      const id = ++idRef.current;
      setState((s) => ({ ...s, running: true, progress: 0, error: null }));
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const msg = e.data;
        if (msg.id !== idRef.current) return;
        if (msg.type === 'progress') {
          setState((s) => ({ ...s, solution: msg.solution, progress: msg.progress }));
        } else if (msg.type === 'done') {
          setState({ solution: msg.solution, running: false, progress: 1, error: null });
          worker.terminate();
          if (workerRef.current === worker) workerRef.current = null;
        } else {
          setState((s) => ({ ...s, running: false, error: msg.message }));
        }
      };
      worker.onerror = (e) => setState((s) => ({ ...s, running: false, error: e.message || 'Optimizer failed' }));
      worker.postMessage({ id, project: projectRef.current });
    }, 300);
    return () => clearTimeout(timer);
  }, [key]);

  useEffect(() => () => workerRef.current?.terminate(), []);

  return state;
}

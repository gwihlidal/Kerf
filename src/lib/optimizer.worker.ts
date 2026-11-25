import { optimize } from './optimizer';
import type { Project, Solution } from './types';

export type WorkerResponse =
  | { type: 'progress'; id: number; solution: Solution; progress: number }
  | { type: 'done'; id: number; solution: Solution }
  | { type: 'error'; id: number; message: string };

self.onmessage = (e: MessageEvent<{ id: number; project: Project }>) => {
  const { id, project } = e.data;
  try {
    const solution = optimize(project, ({ solution, progress }) => {
      self.postMessage({ type: 'progress', id, solution, progress } satisfies WorkerResponse);
    });
    self.postMessage({ type: 'done', id, solution } satisfies WorkerResponse);
  } catch (err) {
    self.postMessage({ type: 'error', id, message: String(err) } satisfies WorkerResponse);
  }
};

# Kerf — Cut List Optimizer

A modern web app for planning plywood / sheet-goods cuts with minimal waste.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # optimizer + unit-parsing tests
npm run build      # production build in dist/
```

## Features

- **Parts & stock editors**: inputs accept `23 1/2`, `23-1/2`, `3/4`, `4'6"`, `8ft`, `600mm`, `60cm` and `10 + 3/4`.
- **Live optimization** in a Web Worker: layouts update as you type.
- **Two cutting modes**
  - *Table / panel saw*: guillotine cuts only, with a numbered rip/crosscut sequence.
  - *CNC / free-form*: MaxRects nesting for the densest packing.
- **Real-world constraints**: blade kerf, edge trim, grain direction (per part and per sheet), limited or unlimited stock, several sheet sizes, per-sheet cost (0 = offcuts you already own), and multiple materials.
- **Objectives**: least waste or fastest cutting (cuts + fence changes), with fast / balanced / thorough search effort.
- **Results**: yield, waste, cut count and cut length, cost, identical sheets grouped, usable offcuts, and a zoom view with numbered cuts.
- **I/O**: paste parts from Excel/Sheets/CSV, export CSV, save/open `.kerf.json` project files, print or save as PDF. Autosaves to local storage.
- Light/dark themes, inch/mm switching with conversion.

## Batched cutting plan (`src/lib/cutplan.ts`)

Every guillotine cut records the cut that produced the piece it cuts, so each sheet forms a cut tree. The scheduler reorders cuts across **all sheets of a material** into steps that share one fence setting (rip or crosscut at a given distance), always respecting the tree, because a piece must exist before you can cut it. Identical strips therefore get ripped, and then crosscut, together.

Each step picks the fence setting that runs the most cuts in a row, including cuts that only become possible during the run. Settings that can be *finished* now are preferred so they never need re-setting. Several greedy strategies plus randomized restarts are tried, and the plan with the fewest setups wins. The optimizer also favours layouts with fewer distinct fence settings. "Fastest cutting" weighs cuts plus fence changes directly; "Least waste" uses setups as a tie-breaker after sheet usage and offcut size.

The UI shows a project-wide **Cutting plan** (step, setting, cut count, sheets involved) and per-sheet sequences grouped by step. Hover a step to highlight its cuts on the diagrams.

## How the optimizer works (`src/lib/optimizer.ts`)

1. Kerf is modelled by growing each part and the usable sheet by one kerf, which turns the problem into gap-free rectangle packing.
2. Parts are grouped by material. Each group runs a deterministic sweep of
   6 sort orders × 4 fit rules × 8 guillotine split rules.
3. When a new sheet has to be opened, every available stock size is tried. If the remaining parts all fit, the cheapest (or smallest) sheet wins; otherwise the sheet with the best value (part area per unit cost or area) wins.
4. The best candidates are then refined by randomized local search over part orderings. The search stops when the time budget runs out or no improvement has been found for a while.
5. Solutions are ranked by unplaced area → stock cost (or area) → sheet area, then either offcut size → fence settings → cuts (least waste) or cuts + 2 × fence settings (fastest cutting).

## Docker

```bash
docker compose up -d --build                 # production build served by nginx → http://localhost:8080
docker compose --profile dev up dev          # Vite dev server with hot reload → http://localhost:5173
```

- `web` is a multi-stage image. Stage 1 (`node:24-slim`) installs dependencies, runs the test suite and builds the app; the image build fails if any test fails. Stage 2 (`nginx:alpine`) serves `dist/` with gzip, long-lived caching for fingerprinted assets, `no-cache` on `index.html`, and a `/healthz` endpoint used by the container healthcheck.
- `dev` mounts your source and keeps Linux `node_modules` in a named volume. It enables file polling so hot reload works through Windows/macOS bind mounts.
- Change the ports with `KERF_PORT` / `KERF_DEV_PORT`, e.g. `KERF_PORT=3000 docker compose up -d`.

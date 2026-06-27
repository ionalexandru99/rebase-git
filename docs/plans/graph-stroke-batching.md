# Plan: batch canvas strokes by color, hoist per-frame style reads

**Status:** Done — implemented on `main`, **uncommitted** (awaiting the user's commit).
**Owner:** TBD
**Created:** 2026-06-27

## Goal

Cut the per-frame cost of painting the commit-graph rail without changing what
it draws: fewer `stroke()` calls and no per-frame style resolution.

## Why

Profiling the canvas draw loop against `phoenix-api` (wide history) found two
main-thread costs that recur on every scroll frame:

- The draw loop issued a separate `beginPath()`/`stroke()` per lane segment —
  3,293 calls/frame at p50, **8,384 worst case**.
- `drawCanvas` re-read `getComputedStyle(document.documentElement)` (via
  `readCssVar`) and `window.devicePixelRatio` on **every** frame, forcing a style
  resolve ~60×/sec for values that only change on theme/resize.

## What changed

- `src/renderer/lib/git-graph/canvas.ts` — `drawGraphRow` now collects edge
  segments into a batch keyed by `(alpha, color)` and strokes once per distinct
  color; commit dots draw in a second pass so they stay on top. Stroke calls per
  frame dropped to **O(distinct lane colors)** (≤ 8 for a uniform dim state, ≤ 16
  when a frame mixes dimmed and non-dimmed rows), independent of segment count.
- `src/renderer/components/HistoryPanel/CommitGraphCanvas.tsx` — frame-level
  batching across visible rows; `devicePixelRatio`, `--color-background`, and
  `--color-chart-3` captured once per effect setup. Scrolling now triggers zero
  `getComputedStyle` calls; a `themeNonce` change refreshes them.
- Tests added in both `__tests__` files pinning the batching bound, edge-geometry
  preservation, and the "no per-frame `getComputedStyle`" behavior.

## Notes / trade-offs

- **Not strictly pixel-identical:** at same-color segment joins, batching
  overlapping semi-transparent round line-caps into one stroke composites slightly
  differently than N separate strokes — in practice this removes faint
  double-darkened seams. Merge rings still stroke once per merge row by design.
- A stray `NUL` (0x00) byte was introduced as a batch-key delimiter during
  implementation (made `canvas.ts` register as binary to git); replaced with `|`.

## Validation (all green)

- `pnpm check` — 267 files, no fixes.
- `pnpm typecheck` — pass.
- `pnpm test:renderer` — 406/406 pass.

## Follow-up

Commit with a Conventional Commits message, e.g.
`perf(renderer): batch graph strokes by color and hoist per-frame style reads`.

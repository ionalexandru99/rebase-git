# Plan: debounce the filter ancestor-walk; dedupe per-row lane snapshots

**Status:** Implemented in the current worktree; retained-heap measurement remains.
**Owner:** TBD
**Created:** 2026-06-27

## Goal

Two independent efficiency fixes in the graph pipeline: stop recomputing the branch
filter on every streaming flush, and stop storing each row's lane state twice.

## Why

### A. Un-debounced filter ancestor-walk

`useTimelineVisibility` recomputes `filteredCommits` via `computeBranchFilterSet`
(an ancestor walk over the loaded commits) in a `useMemo` keyed on the `commits`
array identity. During streaming, `commits` gets a new identity on every 100 ms log
flush, so the walk re-runs each flush while a filter is active. Measured on
`phoenix-api`: **~3.1 ms per walk over 50k commits**, repeated throughout a stream,
stacking with the layout recompute on the main thread.

### B. Doubled per-row lane snapshots

`layoutCommits` stores each row's lanes as **two** full `(string | null)[]`
snapshots — `incoming = [...lanes]` and `outgoing = [...lanes]` (`layout.ts`). For
50k rows on `phoenix-api` that's **6.16 M lane slots / ~22 MB**, and `incoming[N]`
is almost identical to `outgoing[N-1]` (a boundary is shared between adjacent rows).
Across multiple repo tabs this multiplies.

## Implemented change

### A. Coalesced filter recompute

- `useCoalescedCommitSnapshot` publishes streaming commit snapshots at most once per
  `GRAPH_LAYOUT_DEBOUNCE_MS` window instead of once per 100 ms log-cache flush.
- The final snapshot publishes immediately when streaming completes, and pending
  timers are cancelled on unmount.
- The existing `WeakMap` index caches (`getCommitIndex`, `getRefTipIndex`) retain
  their per-array release behavior.

### B. Shared lane boundaries

- `LayoutResult` stores chunked lane **boundaries**. Row `i` reads its incoming
  boundary at `i` and outgoing boundary at `i + 1`, so adjacent rows share storage.
- Rows and boundaries remain chunked, allowing incremental layout to retain previous
  chunks without copying the entire result.
- Typed-array interning was not added: the worker currently uses the same layout
  shape and structured cloning. Revisit only if profiling identifies clone or heap cost.

## Dependency / sequencing

Do `graph-width-and-merge-collapse` first: collapsing merges cuts both the row count
and lane width, shrinking both costs here. The typed-array boundary encoding (B) is
shared with `graph-layout-web-worker`'s transfer format — coordinate so it's
designed once.

## Risks / things to watch

- Incremental reachable-set maintenance must handle the existing
  cancel/clear/restart paths in `commit-history.tsx` without leaving a stale set.
- Changing the row lane representation touches the canvas draw and the row component;
  the geometry-lock tests from `graph-stroke-batching` guard against visual drift —
  keep them green.

## Verification

- During a `phoenix-api` stream with a filter active, the ancestor walk runs once
  per frame at most (assert via a spy/counter), not once per flush.
- Layout memory for 50k rows roughly halves (compare retained heap before/after).
- Canvas output is byte-identical to today for representative rows (geometry-lock
  tests pass unchanged).
- `pnpm typecheck`, `pnpm lint`, `pnpm check` clean; `pnpm test:renderer` green.

## Acceptance criteria

- [x] Filter ancestor-walk no longer runs per 100 ms log flush while streaming.
- [x] Per-row lane state stored once (boundary array), not as `incoming` + `outgoing`
      duplicates.
- [ ] Layout memory measurably reduced on a large repo.
- [x] Existing layout, canvas geometry, and graph component tests cover the new shape.

# Plan: debounce the filter ancestor-walk; dedupe per-row lane snapshots

**Status:** Not started — cleanup that compounds with `graph-width-and-merge-collapse`.
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

## Proposed change

### A. Coalesce the filter recompute

- Debounce/coalesce the `computeBranchFilterSet` recompute so it runs at most once
  per animation frame (or once per layout debounce window), not once per flush.
- Or maintain the reachable set incrementally as commits append (the stream is
  topo-ordered, children before parents — the same property `pruneAncestorTips`
  already relies on), so a flush only walks the newly arrived commits.
- The existing `WeakMap` index caches (`getCommitIndex`, `getRefTipIndex`) already
  release per commits-array; keep that property.

### B. Store each lane boundary once

- Represent the layout as a single array of lane **boundaries** (length `rows + 1`):
  `incoming` of row `i` is `boundaries[i]`, `outgoing` is `boundaries[i + 1]`. Halves
  the slot count and the allocations.
- Or go further and pack boundaries as typed arrays of **interned commit indices**
  (`Int32Array`) instead of `(string | null)[]` — smaller, GC-friendly, and exactly
  the encoding the worker plan (`graph-layout-web-worker`) wants to transfer.
- `drawGraphRow` / `CommitRow` read `incoming`/`outgoing` — adapt them to the
  boundary representation (or expose `incoming`/`outgoing` as thin views) so the
  public row shape stays convenient.

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

- [ ] Filter ancestor-walk no longer runs per flush; coalesced or incremental.
- [ ] Per-row lane state stored once (boundary array), not as `incoming` + `outgoing`
      duplicates.
- [ ] Layout memory measurably reduced on a large repo.
- [ ] No visual regression in the graph; existing geometry tests pass.

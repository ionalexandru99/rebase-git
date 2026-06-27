# Rebase plans

Index of planned and in-flight workstreams. Each plan under `docs/plans/` is
self-contained and can be picked up independently — pull one onto the table at a
time. Keep this index's status column current as plans land.

## Status

| Plan | Area | Status | One-line |
|------|------|--------|----------|
| [electron-postinstall-cleanup](electron-postinstall-cleanup.md) | Build | Not started | Let Electron's postinstall fetch the binary; retire the runtime helper. |
| [graph-stroke-batching](graph-stroke-batching.md) | History graph | **Done** (uncommitted on `main`) | Batch canvas strokes by lane color; hoist per-frame CSS-var/DPR reads. |
| [graph-width-and-merge-collapse](graph-width-and-merge-collapse.md) | History graph | Decided, not started | Collapse merge side-branches by default (expand on demand) + bound the gutter. |
| [graph-layout-web-worker](graph-layout-web-worker.md) | History graph | Not started | Move full-recompute lane layout off the renderer main thread. |
| [graph-filter-walk-and-memory](graph-filter-walk-and-memory.md) | History graph | Not started | Debounce the filter ancestor-walk; dedupe per-row lane snapshots. |

## History-graph roadmap

The four graph plans came out of profiling the commit-history pipeline
(streaming → branch filter → lane layout → canvas paint → virtualized rows)
against two real, large repositories. Shared evidence, so each plan doesn't have
to re-derive it:

**`phoenix-api`** — 79,077 commits, 7,211 branches, 602 MB `.git`.

- Parse 50k commits: 23 ms (non-issue).
- One-shot lane layout (the full-recompute path a filter toggle triggers), on the
  renderer main thread: 2k = 3.5 ms, 10k = 25 ms, 25k = 72 ms, **50k = 118 ms**.
- Incremental append (streaming page): ≤ 9 ms — already fine, leave it.
- Lane width per row: p50 46, p90 78, **max 121** → implied gutter p90 1,260 px,
  max 1,948 px.
- Canvas stroke calls per frame, before batching: p50 3,293, **worst 8,384**.
- Filter ancestor-walk (`computeBranchFilterSet`): ~3.1 ms, run **un-debounced**
  on every 100 ms log flush while a filter is active.
- Layout memory at 50k rows: ~22 MB, **6.16 M lane slots** (`incoming` + `outgoing`
  stored as two near-identical snapshots per row).

**`linux`** (`master` only) — first 8,000 commits: lane width **p50 71, max 87**.
The decisive finding: width is intrinsic to a merge-heavy mainline, **not** an
artifact of showing extra branches. Reducing the visible ref set does not fix it;
the graph itself must be bounded and/or simplified. This is what motivates
collapsing merges by default in `graph-width-and-merge-collapse`.

### Suggested order

1. **graph-width-and-merge-collapse** — biggest felt improvement; also shrinks the
   inputs that make the other plans matter (fewer lanes, fewer rows).
2. **graph-layout-web-worker** — reassess after #1; collapsing merges may reduce
   layout cost enough to lower its priority.
3. **graph-filter-walk-and-memory** — cleanup that compounds with #1.

`graph-stroke-batching` already shipped (uncommitted on `main`).

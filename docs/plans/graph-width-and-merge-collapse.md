# Plan: bound the graph gutter; collapse merge side-branches by default

**Status:** Decided (direction), not started.
**Owner:** TBD
**Created:** 2026-06-27

## Goal

Make the history graph legible and stable no matter how wide the underlying DAG
is. Two halves:

1. **Collapse merges by default** — a merge commit hides the commits it brought in
   from the merged branch, so the default view is a near-linear mainline. Provide
   an affordance to expand a merge and reveal its side-branch commits (and
   re-collapse). *This is the chosen primary direction (decision 2026-06-27).*
2. **Bound the graph gutter** — even a collapsed or focused view can still be wide
   (see `linux` below), so the rail must have a maximum width and the commit
   metadata columns must keep a guaranteed minimum. The exact bounding strategy is
   still open (see "Open decision" below).

## Why — the reported bug, grounded

Opening `linux` and scrolling produces a graph rail that grows until it eats the
entire panel: the `Subject` column (`minmax(0,1fr)`) collapses to zero, the header
labels "SUBJECT"/"AUTHOR" overlap, and once a wide region has loaded the gutter
never shrinks again.

Profiling pinned the cause. **Even with only `master` visible**, the first 8,000
commits of `linux` are **p50 71 lanes wide, max 87** — a gutter of ~1,400 px. The
width is intrinsic to a merge-heavy mainline (linux merges hundreds of subsystem
branches), *not* an artifact of showing extra refs. So:

- Reducing the visible ref set (e.g. defaulting to the current branch) does **not**
  fix this — the header already reads "1 branch visible" in the bug screenshot.
- The graph must be simplified (collapse merges) and/or hard-bounded (cap the
  gutter). Showing 87 crossing lanes is not useful to a reader anyway.

### Two distinct defects

- **Unbounded gutter width.** `computeGraphRailWidth(maxLanes)` grows without limit
  and `Subject` is `minmax(0,1fr)`, so it collapses to zero and labels overlap.
- **"Never goes back" + header/row mismatch.** `layout.maxLanes` is the running max
  over *all* loaded rows (monotonic), and the header grid uses that global max
  (`HistoryPanel.tsx` `graphRailWidth`) while each row uses its own
  `computeRowRailWidth` (`CommitRow.tsx`). The two disagree, and the global max
  never shrinks even when you scroll into a narrow region.

## Current state

- Sidecar log query: `git log -z --branches --remotes --topo-order` (all parents
  of every commit are in the stream — see `src/sidecar/log-stream.ts`).
- Lane layout: `src/renderer/lib/git-graph/layout.ts` — greedy lane assignment over
  the full parent list of each commit; merges open a lane per extra parent.
- Filter: `useTimelineVisibility` filters `commits` to ancestors of the visible
  refs; layout runs on that filtered set.
- Width: `computeGraphRailWidth` / `computeRowRailWidth` in
  `src/renderer/lib/git-graph/canvas.ts`; header column template in
  `HistoryPanel.tsx`, per-row template in `CommitRow.tsx`.

## Proposed change

### Part A — Table-stakes column fix (do this regardless of strategy)

- Use **one** rail-width source for the header grid, the canvas, and the rows. Kill
  the `computeGraphRailWidth(maxLanes)` (header) vs `computeRowRailWidth(row)` (row)
  split — pick one and feed it to all three.
- Give `Subject` a real minimum (`minmax(<min>, 1fr)` instead of `minmax(0,1fr)`) so
  the metadata columns can never be squeezed to zero.

### Part B — Collapse merge side-branches by default (primary direction)

Default the timeline to a **first-parent mainline view**: when laying out, follow
only each commit's first parent; a merge's additional parents (the merged-in side
branch) are **collapsed** — their commits are not rendered as rows, and the merge
is marked expandable.

- **Width impact:** linux mainline first-parent is ~1–2 lanes. This is the single
  biggest win for the common case.
- **Expansion:** a per-merge toggle reveals the commits unique to that merge's side
  branch (the range `firstParent..mergeParentN`, stopping where it rejoins the
  mainline). Expanded commits insert as rows under the merge with their own lanes;
  re-collapsing removes them.
- **No extra git call needed (for now):** the side-branch commits are already in the
  stream (`--branches --remotes` includes them). Expansion is a pure render/layout
  toggle over data we hold. *If* we later switch the log query to `--first-parent`
  for performance, expansion would need an on-demand fetch of the side range —
  call that out as a dependency before making that switch.
- **State:** an `expandedMerges: Set<hash>` per repo/tab. Collapsing is orthogonal
  to the existing ref filter — even with `master` visible, merged subsystem branches
  collapse.

Design questions to resolve during implementation:

- First-parent reachability vs the existing ancestor-based filter: a collapsed view
  shows first-parent ancestry of the visible tips; expansion locally widens it.
  Define how `computeBranchFilterSet` and the collapse interact (collapse is a
  render filter layered on top of the ref filter).
- Nested / chained merges: expanding a merge whose side branch itself contains
  merges — expand one level, or recursively? Default to one level, expandable
  again.
- Octopus merges (≥ 3 parents): expand each extra parent's range; UI affordance for
  multiple collapsed branches on one merge.
- Commits reachable from multiple merges (a side branch merged in more than once):
  ensure a commit renders once and de-dupes across expansions.
- Where the affordance lives: a caret/▸ on the merge row's graph cell or subject;
  keyboard support; visual treatment of an expanded region (indent/tint).

### Part C — Bound the gutter (open decision)

Even with merges collapsed, an expanded region or a genuinely wide focus can exceed
the available width. The rail needs a hard maximum with one of these behaviors
(see the side-by-side mockups captured with the user; recommendation: **compress**):

- **Compress lanes to fit** *(recommended)* — shrink lane spacing (`COL_W`) so all
  lanes fit a bounded gutter; every dot stays visible, width is stable, least code.
  Dense "barcode" at extreme widths.
- **Cap lanes + overflow marker** — render ≤ ~16 lanes, bundle the rest into a
  collapsed "+N" lane. Predictable, clean, loses exact topology past the cap.
- **Bounded gutter + horizontal scroll** — fix the gutter width; the graph scrolls
  horizontally while metadata stays pinned. Full topology, most work.

## Open decision

The user chose **collapse-merges-by-default + expand-on-demand** as the primary
mechanism. The Part C bounding strategy (compress / cap / horizontal-scroll) is
**not yet chosen** — decide before implementing Part C. Recommendation: compress.

## Risks / things to watch

- A first-parent default changes what users see versus today's full graph — make
  the collapse visually obvious (merge rows must read as "there's more here") so it
  isn't mistaken for missing history.
- Expansion that re-lays-out a region must stay cheap and not reintroduce the
  main-thread jank tracked in `graph-layout-web-worker`.
- The bounding fallback must keep each commit's **own** dot visible (don't clip a
  commit off-gutter) — this rules out naive clipping.
- Keep parity with the ref filter / FocusRail semantics and the off-branch dimming.

## Verification

- `linux` with `master` visible renders a near-linear graph by default; the
  `Subject`/`Author`/`SHA`/`Date` columns are fully legible and never overlap.
- Expanding a mainline merge reveals its side-branch commits; collapsing hides them
  again; width returns to baseline.
- Header gutter and row gutters always agree; the gutter has a hard maximum and
  shrinks when appropriate (no "never goes back").
- `phoenix-api` and a deep octopus-merge case render without layout breakage.
- `pnpm typecheck`, `pnpm lint`, `pnpm check` clean; renderer + e2e tests cover the
  collapse toggle and the column-min invariant.

## Acceptance criteria

- [ ] One rail-width source for header, canvas, and rows; `Subject` has a non-zero
      minimum width.
- [ ] Merges collapse their side-branch commits by default (first-parent view).
- [ ] A per-merge expand/collapse affordance reveals/hides side-branch commits.
- [ ] The gutter has a maximum width via the chosen Part C strategy; every commit
      dot stays visible.
- [ ] `linux` and `phoenix-api` are legible and stable while scrolling/loading.

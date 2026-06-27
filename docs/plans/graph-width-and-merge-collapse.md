# Plan: collapse merges by default; bound the gutter by underlap occlusion

**Status:** Decided (design grilled 2026-06-27). PRD: issue #128. Not started.
**Owner:** TBD
**Created:** 2026-06-27

## Goal

Make the history graph legible and stable no matter how wide the underlying DAG
is. Two halves, now resolved into a single coherent design (see the ADRs):

1. **Collapse merges by default** — the Timeline shows each visible tip's
   **Mainline** (first-parent line); a merge's **Side branch** commits are hidden
   until the merge is expanded. ADR 0004.
2. **Bound the gutter by underlap occlusion** — the graph + message form a left
   layer that slides behind the pinned, opaque metadata columns; the metadata is
   always legible, so the graph can never eat the panel. ADR 0005. This replaces
   the earlier open "compress / cap / horizontal-scroll" decision.

## Why — the reported bug, grounded

Opening `linux` and scrolling produces a graph rail that grows until it eats the
entire panel: the message column (`minmax(0,1fr)`) collapses to zero, the headers
overlap, and once a wide region has loaded the gutter never shrinks again.

Profiling pinned the cause. **Even with only `master` visible**, the first 8,000
commits of `linux` are **p50 71 lanes wide, max 87** — a gutter of ~1,400 px. The
width is intrinsic to a merge-heavy mainline, *not* an artifact of extra refs.
Reducing the visible ref set does **not** fix it; the graph must be simplified
(collapse merges) and the layout must make wide gutters structurally harmless.

## Decisions (from the grilling — see issue #128 for the full PRD)

1. **Renderer-side collapse, not a `--first-parent` query** (ADR 0004). The sidecar
   log query is unchanged; collapse is a subtractive filter in the renderer between
   the ref filter and layout. Expansion is instant (data already held). Loaded
   memory and the ref ancestor-walk are unchanged — collapse shrinks rendered rows
   and lane width only.
2. **Default view = union of visible tips' Mainlines.** Making a ref visible always
   reveals its first-parent line; collapse only hides merge-internal commits of refs
   not separately made visible. Collapse is orthogonal to the ref filter.
3. **Model:** `displayed = mainline(visibleTips) ∪ ⋃ expanded Side ranges`;
   `hidden = refFiltered − displayed`. A set union, so each commit renders once
   (dedup is automatic — this dissolves the old "de-dupe across expansions" question).
4. **Expansion is one level and recursive.** Expanding reveals only the Side parent's
   first-parent line down to the merge-base; nested merges stay collapsed, each with
   its own control. *(Corrects the earlier `firstParent..parentN` wording, which was
   the full subtree.)* Octopus merges: one control reveals all extra parents' lines.
5. **Expanded commits are unhidden in place** in topo order (keeps the Side branch
   contiguous under its merge); not spliced as a separate block.
6. **`expandedMerges`** is an ephemeral in-memory `Set<hash>` per tab, keyed/reset by
   repo path like the visible-refs selection; survives streaming + ref-filter toggles;
   not persisted across restart.
7. **Affordance:** a `+`/`−` glyph inside the merge dot (drawn on the canvas), with a
   transparent DOM button overlaid for click + `aria-expanded` (the canvas is
   aria-hidden). Glyph only on merges that actually have a collapsible Side branch.
8. **Search auto-reveals matches.** While searching, match the full ref-filtered set
   and temporarily expand the chain of merges needed to surface each match; restore
   the manual `expandedMerges` when the search clears.
9. **Underlap layout** (ADR 0005). Drop the message column + "SUBJECT" header; pin
   Author/SHA/Date right, opaque, on top (`pointer-events: none`); graph + message
   underlap behind them. Occlusion is the gutter bound — no compress/cap/scroll.
   Header/row agreement is automatic; the global max-lanes width computation is no
   longer needed for column sizing.

## Current state (touch points)

- Sidecar log query: `git log -z --branches --remotes --topo-order`
  (`src/sidecar/log-stream.ts`) — **unchanged** by this work.
- Ref filter: `useTimelineVisibility` → `computeBranchFilterSet`
  (`src/renderer/components/HistoryPanel/selectors.ts`).
- New collapse selectors live alongside it (the primary test seam): `computeMainlineSet`,
  `computeCollapsedView`, `sideRange`, `mergesToRevealMatches`, `mergeGlyphState`.
- Lane layout: `src/renderer/lib/git-graph/layout.ts` — runs over the (now smaller)
  Collapsed view.
- Width / grid: `computeGraphRailWidth` / `computeRowRailWidth`
  (`src/renderer/lib/git-graph/canvas.ts`), header template in `HistoryPanel.tsx`,
  per-row template in `CommitRow.tsx` — restructured for the underlap layout.

## Suggested PR sequence

Each PR is one self-contained commit (per CLAUDE.md):

1. **Underlap layout** — fixes the reported acute bug on its own (metadata always
   legible, nothing collapses to zero).
2. **Collapse + `±` dots** — the primary collapse/expand feature.
3. **Search auto-reveal** — depends on (2).

## Risks / things to watch

- A first-parent default changes what users see versus today's full graph — the `+`
  on every collapsible merge dot is what signals "there's more here."
- Expansion re-lays-out a region; keep it cheap (the `graph-layout-web-worker` plan).
- Underlap occlusion can hide a far-right dot in a deeply expanded region (accepted,
  ADR 0005) — the outermost expand control is always on a visible Mainline, so a
  region can always be re-collapsed.
- Keep parity with the ref filter / FocusRail semantics and off-branch dimming.

## Verification

- `linux` with `master` visible renders a near-linear graph by default; Author/SHA/Date
  stay fully legible and never overlap while scrolling/loading.
- Clicking a merge's `+` reveals its Side branch; `−` hides it again; width returns to
  baseline.
- Search surfaces a match that lives inside a Collapsed merge.
- `phoenix-api` and a deep octopus-merge case render without layout breakage.
- `pnpm typecheck`, `pnpm lint`, `pnpm check` clean; selectors unit + jsdom component +
  e2e tests cover the collapse view, the toggle, and the legibility invariant.

## Acceptance criteria

- [ ] One uniform left layer; Author/SHA/Date pinned, opaque, always legible; no
      message column to squeeze to zero.
- [ ] Merges collapse their Side-branch commits by default (union of Mainlines).
- [ ] A `+`/`−` merge-dot control reveals/hides Side-branch commits, one level, recursive.
- [ ] `expandedMerges` is per-tab, ephemeral, survives streaming + ref toggles.
- [ ] Search auto-reveals matches hidden in Collapsed merges, non-destructively.
- [ ] `linux` and `phoenix-api` are legible and stable while scrolling/loading.

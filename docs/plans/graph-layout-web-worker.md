# Plan: move full-recompute lane layout off the renderer main thread

**Status:** Not started — reassess after `graph-width-and-merge-collapse`.
**Owner:** TBD
**Created:** 2026-06-27

## Goal

Stop the renderer main thread from freezing when the commit graph re-lays-out from
scratch, so scrolling and typing stay smooth on large histories.

## Why

`useGraphLayout` runs `layoutCommits` synchronously (inside a debounced
`setTimeout`) on the renderer main thread. Measured on `phoenix-api`:

| commits | one-shot relayout | incremental append page |
|--------:|------------------:|------------------------:|
| 2,000   | 3.5 ms ✓          | ~5 ms ✓ |
| 10,000  | **25 ms**         | ~5 ms ✓ |
| 25,000  | **72 ms**         | ~5 ms ✓ |
| 50,000  | **118 ms** (≈7 frames) | 9 ms worst ✓ |

The incremental append path (streaming a new page onto a matching prefix) is cheap
and should **stay on the main thread**. The freeze is only on the *non-extendable*
path — a branch-filter toggle or any change that makes the commit sequence not a
prefix of the previous one forces a full O(commits × lanes) recompute. On a 79k-commit
repo you reach 10k–50k loaded commits easily, so a filter toggle there is a hard
25–118 ms input stall.

## Proposed change

Move the full `layoutCommits` recompute into a **Web Worker** in the renderer. The
layout input (`filteredCommits`) is renderer-derived, so a worker is the natural
boundary.

- Post the commit list (or a compact encoding — hashes + parent indices, not the
  full messages) to the worker; receive `RowLayout[]` (or a transferable encoding)
  back.
- Keep the incremental extend path on the main thread (it's ≤ 9 ms and benefits from
  zero round-trip latency), or run it in the worker too if that simplifies the code
  — measure both.
- Once layout is off-thread, the 250 ms `GRAPH_LAYOUT_DEBOUNCE_MS` can likely drop
  for a snappier feel.

### Considerations

- **Serialization cost.** Passing 50k commits and receiving their rows crosses a
  structured-clone boundary. Measure clone time; if it's significant, pass a compact
  representation (intern hashes to integer ids; send `Int32Array` parent lists and
  receive an `Int32Array` lane assignment + boundary table) and reconstruct
  `RowLayout` lazily on the main side. This dovetails with the lane-snapshot
  compaction in `graph-filter-walk-and-memory`.
- **Sidecar precompute (alternative).** The sidecar (`utilityProcess`) is already
  off the main thread and could emit lane assignments alongside each log chunk for
  the **unfiltered** full graph. But filtered/collapsed views must re-lane in the
  renderer, so this is only a partial win. Prefer the worker; note the sidecar
  option for the unfiltered default if it proves worthwhile.
- **Staleness / cancellation.** A newer relayout must supersede an in-flight worker
  result (mirror the stream-id guarding already used in `commit-history.tsx`).

### Dependency on `graph-width-and-merge-collapse`

Collapsing merges by default shrinks both the row count and the lane count fed to
layout, which directly lowers recompute cost. **Do that plan first, then re-measure**
— it may drop the worst-case relayout enough that the worker becomes lower priority
(still valuable for wide expanded views and large filtered sets).

## Verification

- Toggling a branch filter on a 50k-commit `phoenix-api` load keeps the main thread
  responsive (no long task > ~16 ms); the graph updates without a visible stall.
- Incremental streaming is unchanged (no regression in append latency).
- A rapid sequence of filter toggles cancels superseded layouts; the final render
  matches the last selection.
- `pnpm typecheck`, `pnpm lint`, `pnpm check` clean; tests cover the
  cancellation/staleness guard.

## Acceptance criteria

- [ ] Full-recompute layout runs in a Web Worker; no synchronous `layoutCommits`
      over large inputs on the main thread.
- [ ] Incremental streaming latency unchanged.
- [ ] Superseded layouts are cancelled; no stale render wins.
- [ ] Re-measured after `graph-width-and-merge-collapse`; priority confirmed or
      downgraded with numbers.

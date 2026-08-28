# Incremental commit DAG layout and rendering

Research for [Evaluate incremental commit-DAG layout and rendering strategies](https://github.com/ionalexandru99/rebase-git/issues/314).

## Decision

Use a small, typed, Git-style lane reducer for layout and a hybrid browser renderer:

- The server returns bounded pages of commits in child-before-parent order. Each commit includes every parent OID.
- The web client reduces those records into immutable row plans. A serializable lane checkpoint carries the active columns across page boundaries.
- TanStack Virtual renders the visible commit rows as semantic DOM. Rebase already depends on it and uses it in the branches sidebar.
- One viewport-sized Canvas 2D layer draws only the visible lane segments and commit glyphs. It is presentational. DOM rows own focus, selection, pointer hit targets, context menus, text, and accessible relationships.
- Layout uses no viewport width. Resize changes lane pitch, clipping, and commit text space, but never lane identity or commit order.

Do not adopt ELK, Cytoscape, Sigma, GitGraph.js, SVG-per-row, or a WebGL renderer for the first version. They either relayout the whole DAG, retain more graph than the viewport needs, add an interaction model Rebase would have to fight, or make accessibility harder. The visible graph is a few dozen rows with potentially many lanes, not a free-positioned million-node scene. Canvas 2D is enough once vertical and horizontal work are clipped to the viewport.

This decision deliberately separates layout from rendering. The lane reducer should be testable without React or a browser, and the renderer should consume numeric row geometry without knowing Git traversal rules.

## Fit with the current code

The existing architecture already has the useful pieces:

- [`@tanstack/react-virtual` is a web dependency](../../src/apps/web/package.json), and the [branches sidebar](../../src/apps/web/features/branches-sidebar/branches-sidebar.tsx) uses stable rows, overscan, `scrollToIndex`, and `aria-activedescendant`.
- The [repository workspace](../../src/apps/web/features/repository-workspace/repository-workspace.tsx) is a resizable panel. The graph must therefore react to element size, not only `window.resize`.
- The [browser shortcut store](../../src/apps/web/features/keyboard-shortcuts/browser-keyboard-shortcut-storage.ts) already establishes browser-profile `localStorage` as a client-owned persistence mechanism. Graph view settings can follow that boundary. Layout pages and geometry should remain session cache, not persisted view settings.
- The environment protocol caps HTTP responses at 1 MiB and captured command output at 1 MiB in [`environment-transport-limits.contract.ts`](../../src/contracts/environment-connection/environment-transport-limits.contract.ts). The current local Git runner captures a complete child-process result in memory in [`local-git-command-runner.ts`](../../src/apps/server/adapters/local-git/local-git-command-runner.ts). A Linux-scale reader cannot route an entire history through that command shape. The graph transport needs a bounded continuation or a cancellable streaming command path. That transport decision is outside this ticket, but the renderer contract cannot depend on whole-history output.

No graph or rendering library is currently installed. The recommended first version adds none.

## Layout model

### Input invariant

Every page belongs to a view epoch identified by at least repository identity, selected tip OIDs, visibility options, and order. Records arrive in an ancestry-safe order: a child always appears before its parents.

Git already defines the two useful orders. `--topo-order` keeps parents after children and avoids intermixing parallel histories. `--date-order` keeps parents after children while otherwise following commit timestamps. A raw timestamp sort can put a parent before a child and cannot drive this reducer. Rebase's "chronological" mode should therefore mean Git's `--date-order`, not an unconstrained sort. Git's graph mode makes the same restriction and implies topological ordering unless date ordering is requested. See the [git-log ordering and graph documentation](https://git-scm.com/docs/git-log#Documentation/git-log.txt---topo-order).

### State carried between pages

The reducer needs a compact checkpoint, not the preceding rows:

```text
LaneCheckpoint
  epoch
  activeColumns[]
    laneId
    expectedCommitOid
    colorSlot
  nextLaneId
```

Each emitted row plan contains the commit OID, the node lane, transition segments from the incoming columns to outgoing columns, and the maximum column touched by that row. Store coordinates as lane indices and row-relative control points. Do not bake pixels into the plan.

The page cache stores its incoming and outgoing checkpoint. An evicted page can be fetched and laid out again without retaining all earlier commit metadata. Checkpoints are small in normal histories because their size follows concurrent lane width, not total commit count.

### Row transition

For each commit:

1. Find every active column expecting this OID. If none exists, allocate a lane for a new visible tip. If several exist, choose the leftmost as the node lane and route the others into it.
2. Carry unmatched columns through the row.
3. Handle parents in Git order. The first parent continues the node lane when that parent has no existing active column. If it already has one, route to that lane and close the node lane. Additional parents reuse an existing column for the same OID or get a new lane next to the node lane.
4. Deduplicate outgoing columns by expected parent OID.
5. Compact closed columns left with an explicit transition. Keep `laneId` and color stable while its x index changes.
6. Emit the immutable row plan and use the outgoing columns as the next row's input.

This is the useful part of Git's renderer model. Git's [`graph.c`](https://github.com/git/git/blob/master/graph.c) keeps current and next columns plus mappings that route columns into their desired positions. It also retains the previous mapping to avoid ugly leftward movement. Rebase should copy those invariants, not parse `git log --graph` text. The text output inserts extra transition lines, applies presentation-specific parent rewriting, and now has a display lane limit. Parsing it would turn terminal formatting into a protocol.

The reducer is `O(commits in page * active lane width)` with simple arrays. Maps from expected OID to active indices avoid repeated full searches for wide octopus merges. Memory is `O(rows cached * segments per row + active lane width)`. This is predictable, unlike crossing-minimizing global layout.

### What stable means

Appending an older page must not change any previously emitted row plan. Lane position may move left in later rows when a lane closes, but its ID and color continue through that transition. This is the property to test.

Changing selected refs, ordering, full-ancestry visibility, or the tip OIDs starts a new epoch. A ref refresh that adds newer commits cannot be safely prepended to the old geometry because the new tips can introduce columns that cross every row below them. Rebuild the new epoch and preserve the user's visible anchor by commit OID. Do not splice and pretend the lanes stayed stable.

Offset pagination is also the wrong contract. Re-running a walk with `--skip=N` repeats work and can return a different window if refs move. A page continuation must bind to one epoch and either resume a live traversal or detect that the epoch is stale.

### Merge folding

Full ancestry remains the default. A future collapsed merge must transform visibility before lane reduction. It should replace the hidden second-parent subgraph with an explicit boundary or summary row that can be expanded back to the exact DAG.

Hiding already planned rows after layout leaves active columns pointing at commits that no longer exist in the visible sequence. Do not do that. Expanding or collapsing a merge invalidates plans from the fold row downward, then the virtualizer restores the viewport anchor by OID. Rows above the fold remain unchanged.

### Resize and very wide graphs

Lane assignment cannot depend on laptop or ultrawide width. A `ResizeObserver` reports the graph gutter size. The renderer then changes pixel pitch and the visible horizontal lane interval. The [Resize Observer specification](https://www.w3.org/TR/resize-observer/) includes device-pixel box sizes, which avoid guessing how browsers round high-DPI canvas dimensions.

The graph gutter should have a product-defined maximum share of the panel. If concurrent lanes exceed it, clip and horizontally pan the lane region or show an explicit overflow affordance. Never silently drop lanes in the data model. Git's `--graph-lane-limit` and truncation marker show that extreme width needs an explicit display policy, but truth should remain recoverable.

On ultrawide screens, commit metadata gets the extra width. The canvas does not need to become 3440 pixels wide just because the panel does.

## Renderer comparison

| Approach | Incremental and virtualized behavior | Interaction and accessibility | Cost and decision |
| --- | --- | --- | --- |
| Virtual DOM rows plus viewport Canvas 2D | Draws only visible rows and visible lane columns. Append and resize require one bounded redraw. Geometry is independent of React. | DOM rows provide native text, focus, menus, and keyboard behavior. Canvas is `aria-hidden` and ignores pointer events. | Recommended. Small API, no dependency, easy to profile. |
| DOM or CSS lanes | Virtualizing rows bounds commit elements, but every segment still becomes an element with style and layout work. Curves and crossings are awkward. | Native hit testing is available, although the lane elements have no useful semantics. | Reject for lanes. Keep DOM for row content. |
| SVG per row or one viewport SVG | Vector paths are crisp, and [SVG supports ARIA, focus, and labels](https://www.w3.org/TR/SVG/access). A merge-dense viewport can still create thousands of path nodes and style records, and paths must be reconciled during scroll. | Better direct semantics than canvas, but lane segments are not the interactive object. Semantic commit rows are still needed. | Viable prototype fallback, not the default. It spends DOM work where Rebase gets no accessibility benefit. |
| Full-height Canvas 2D | Draw calls are cheap, but bitmap size follows the entire loaded scroll height and quickly hits browser limits and large allocations. | Requires separate semantics. | Reject. Canvas must be viewport-sized. |
| Viewport Canvas 2D without DOM rows | Fast drawing, but text selection, search, focus, context menus, high contrast, and screen-reader relationships all need reimplementation. | The HTML standard asks interactive canvases to map each interactive region to focusable fallback content. | Reject. The fallback would recreate the rows anyway. |
| WebGL, Sigma, or PixiJS | Sigma targets thousands of free-positioned nodes and edges with WebGL. Pixi adds scene and accessibility overlay systems. Both can render more primitives than needed here. | Still needs DOM overlays. Pixi's own accessibility system creates DOM overlays and is unavailable in a worker. Context loss and GPU memory add failure modes. | Reject initially. Reconsider only if measured visible Canvas 2D drawing misses its budget after clipping and batching. |
| Cytoscape.js | Generic graph ownership, canvas rendering, layouts, camera, hit testing, and styling. Its documentation notes that edges, labels, pixel ratio, and canvas area are major costs. It does not solve stable Git lanes or semantic virtual rows. | Provides graph interaction but not the commit-list keyboard and screen-reader contract Rebase needs. | Reject. Too much general machinery and still needs a custom layout. |
| ELK or another Sugiyama layout | Good at global layered DAG layout and crossing reduction. ELK's own FAQ points to unresolved or special handling for dynamic and incrementally added nodes. It must see and reconsider a much larger graph. | Rendering and semantics are separate concerns. | Reject. Global beauty conflicts with append-only row stability, bounded memory, and progressive history. |
| GitGraph.js | Purpose-built illustrations with core and rendering packages. | Designed for authored examples, not a virtualized history browser. | Reject. The repository says it was unmaintained since 2019 and was archived in 2024. |

Relevant library evidence:

- [TanStack Virtual's API](https://tanstack.com/virtual/latest/docs/api/virtualizer) supports overscan, stable item keys, custom range extraction, scroll-to-index, and resize observation. Rebase already pays this dependency cost.
- [Cytoscape's performance guidance](https://js.cytoscape.org/#performance) says canvas work grows with rendered area and pixel ratio, and that edges and labels are expensive.
- [Sigma's documentation](https://www.sigmajs.org/docs/) describes its target as thousands of nodes and edges rendered through WebGL.
- [Pixi's accessibility documentation](https://pixijs.download/dev/docs/accessibility.html) describes the DOM overlay it needs because canvas objects are otherwise invisible to screen readers.
- [ELK.js](https://github.com/kieler/elkjs) is a layout engine, not a renderer, and its documentation explicitly calls out dynamic and incremental layout as a recurring issue.
- [GitGraph.js](https://github.com/nicoespeon/gitgraph.js) is archived and describes itself as a library for blog articles and presentations.

## Canvas and DOM composition

Use one scroll container and one coordinate system:

- The inner spacer owns the currently known virtual height.
- Fixed-height DOM rows are absolutely positioned by TanStack Virtual. Stable commit OIDs are item keys.
- A canvas sits over only the graph gutter and matches the scroll viewport, not the spacer. It draws the virtual range plus overscan, translating row coordinates by the current scroll offset.
- Coalesce scroll, page append, resize, theme, hover, and selection invalidations into at most one `requestAnimationFrame` callback. Do not run a permanent animation loop.
- Batch paths by color and stroke style. Store page geometry in compact numeric arrays to avoid allocating path objects during scroll.
- DOM rows span the graph gutter. They own click, double-click, right-click, tooltip, and keyboard handlers. The canvas uses `pointer-events: none`.
- Size the bitmap from the observed device-pixel box when available, with a tested fallback to CSS size times device pixel ratio. Consider capping the backing ratio at 2 only if high-DPI benchmarks justify the slight loss of sharpness.

The canvas bitmap uses roughly `width * height * DPR^2 * 4` bytes before browser buffering. A 3440 by 1440 canvas at DPR 2 is about 75.6 MiB for one RGBA bitmap. A 640 by 1440 graph gutter at DPR 2 is about 14.1 MiB. This is why the canvas must cover the gutter and viewport only.

The [HTML canvas standard](https://html.spec.whatwg.org/multipage/canvas.html) says interactive canvas regions should map one-to-one to focusable fallback elements. Making the canvas presentational is cleaner here. Each DOM row is the one interactive commit target and carries the equivalent relationship text.

## Keyboard and accessible representation

The visual DAG is not sufficient accessibility. Each rendered commit row should expose:

- subject, abbreviated OID, author, date, and visible ref labels;
- whether it is a merge and the number of parents;
- commands to move to the previous or next visible commit and to jump to each parent or known child;
- the same selection and context-menu command used by pointer input;
- a visible focus state independent of lane color.

Use one focus owner on the virtual list with `aria-activedescendant`, as the branches sidebar does, or a roving focus model proven by the accessibility prototype. A custom TanStack `rangeExtractor` can retain the active row in the DOM when it is just outside the overscan window. If focus moves to an unloaded parent, load and anchor that page before updating the active descendant.

Lane color must never be the only way to understand a relationship. Direction, node shape, merge status text, and parent-jump commands provide redundant cues.

## Bounded memory model

Virtualizing DOM does not bound JavaScript data. Keep these limits separate:

- Cache a fixed number of commit pages around the viewport. A starting point is 512 commits per page and 16 resident pages, then tune from profiles.
- Keep compact incoming and outgoing lane checkpoints for discovered pages even when their commit records are evicted.
- Intern repeated author, ref, and OID data inside the cache epoch where measurements show a win. Do not add a global cache that grows for the life of the application.
- Release page records, numeric geometry, hit-test indexes, and canvas references together on eviction.
- Cancel traversal and page work when repository, scope, order, visibility, or environment changes.
- Do not persist commit data or geometry in browser storage. Persist only the chosen view configuration.

The current 1 MiB HTTP response cap makes a page size based on encoded bytes safer than a fixed commit count. The server may return fewer than 512 commits when messages or ref decorations are large.

## Prototype performance contract

These are gates for the implementation prototype, not claims about code that does not exist yet. Measure a release build on a named reference laptop, then repeat in Electron and current Chrome, Firefox, and Safari where available.

1. After a page reaches the client, reduce and display its first useful rows within 50 ms. No page append or scope change may create a main-thread task over 50 ms.
2. While scrolling, resizing the workspace, and appending pages, p95 frame time stays below 8.3 ms and p99 below 16.7 ms on the reference laptop. A 60 Hz browser has about 16.7 ms for input, script, layout, paint, and compositing, as documented by [Chromium](https://blog.chromium.org/2017/01/performance-improvements-in-chromes.html). The graph should consume only a fraction of that budget.
3. A canvas redraw of the largest visible graph gutter stays below 2 ms p95. If it does not, first clip horizontal lanes, batch segments, and reduce allocation. A worker or WebGL is a later measured response, not the first design.
4. Appending an older page changes zero prior row plans. Assert this by hashing plans before and after append.
5. Resize from 1280x720 to 3440x1440 changes zero lane IDs and zero row ordering. It may change lane pixel coordinates, clipping, and text truncation.
6. The DOM contains only the visible rows plus configured overscan and any retained active row. Loaded history size must not increase the DOM count.
7. With the starting 16-page cache, the graph feature stays within a 64 MiB incremental JS heap budget. Canvas backing-store memory is reported separately because browser and GPU copies are not fully represented in the JS heap.
8. No idle or decorative continuous animation requests frames. Scrolling, resizing, data arrival, theme change, and direct interaction are the only redraw causes.

Test corpora must include:

- a current Linux repository clone;
- a synthetic million-commit history with bounded ordinary lane width;
- repeated nested merges, merge trains, criss-cross merges, octopus merges, and at least 256 simultaneous active lanes;
- both orderings, full ancestry, a one-ref scope, a many-ref scope, and no explicit ref selection;
- sequential page append, cache eviction and reload, scope replacement, ref rewrite, merge fold and expansion, and aborted SSH delivery;
- 1280x720 and 3440x1440 at DPR 1 and 2.

Record time to first useful rows, page reduction time, long tasks, p50/p95/p99 frame time, canvas redraw time, DOM count, JS heap, canvas dimensions, and lane width. Average FPS hides isolated stalls and is not an acceptance metric.

## Risks and follow-up decisions

The technology choice is clear. Two product policies still need explicit decisions in later tickets:

1. Define how users inspect histories wider than the graph gutter. Horizontal lane panning preserves truth. A compact overflow summary is easier on laptops but needs an obvious path to the hidden lanes.
2. Define merge-fold boundaries and summaries. Layout requires the fold to be a first-class visibility operation, not a post-render hide action.

The transport ticket must also preserve the view epoch and return complete parent identities. Without those, no client layout can make page stability honest.

## One-line answer

Use an append-only Git-style lane reducer with serializable page checkpoints, virtualized semantic DOM commit rows, and a viewport-only Canvas 2D lane layer; keep layout width-independent and admit WebGL or workers only if the merge-heavy prototype misses explicit frame and memory gates.

# Merge collapse is a renderer-side filter, not a `--first-parent` query

**Status:** accepted

The Timeline collapses merges by default — showing each visible tip's **Mainline** (first-parent line) and hiding **Side branch** commits until a merge is expanded. This collapse is computed **in the renderer** over the already-streamed log; the sidecar log query is unchanged (it still streams the full `--branches --remotes` history over the streaming RPC, per ADR 0003). Collapse is a subtractive step between the existing ref filter and layout: `displayed = mainline(visibleTips) ∪ ⋃ expanded Side ranges`, `hidden = refFiltered − displayed`. Because `displayed` is a set union, every commit renders exactly once.

## Considered options

- **Renderer-side filter over the full log (chosen).** Expansion is instant — the Side-branch commits are already in memory, so expanding is a pure render/layout toggle with no Git round-trip. Layout runs over the smaller Collapsed view, so layout cost drops.
- **`git log --first-parent` at the sidecar, fetch Side ranges on demand.** Would also cut loaded-commit memory, but makes every expansion an asynchronous Git call and couples this feature to the streaming/query layer.

## Consequences

- **Memory is not reduced by this work.** The full log stays in memory and the ref ancestor-walk still runs over all loaded commits — collapse shrinks *rendered rows* and *lane width*, not loaded memory. The linked perf plans (`graph-layout-web-worker`, `graph-filter-walk-and-memory`) benefit only at the layout stage; their memory/walk costs are tracked separately, not solved here.
- **The `--first-parent` switch is a real future option, gated on a dependency.** If loaded memory becomes the bottleneck, moving the query to `--first-parent` is on the table — but it turns expansion into an on-demand fetch of the Side range. A future engineer tempted to make that switch "for memory" should account for that asynchronous-expansion cost first.

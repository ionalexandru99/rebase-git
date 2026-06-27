# The graph gutter is bounded by underlap occlusion, not by compression

**Status:** accepted

The history graph and the commit message render as a single left-anchored layer; the metadata columns (Author / SHA / Date) are pinned to the right, opaque, and painted on top. When the graph is wide, the graph and message slide *behind* the metadata and are occluded. There is no dedicated commit-message column and no "SUBJECT" header — only the metadata columns carry headers — so header/row width agreement is automatic and the global max-lanes gutter-width computation is no longer needed for column sizing. This is what bounds the gutter: the metadata is always on top and legible, so the graph can never push it off-screen or squeeze the message to zero width.

## Considered options

- **Underlap occlusion (chosen).** Least code — pure z-layering plus opaque backgrounds and dropping a column. Structurally impossible for the graph to "eat the panel."
- **Compress lanes to fit** a bounded gutter (shrink lane spacing). Keeps every dot visible but adds compression math and reads as a dense barcode at extreme widths.
- **Cap lanes + overflow marker** (render ≤ N lanes, bundle the rest). Predictable but loses exact topology past the cap.
- **Bounded gutter + horizontal scroll.** Full topology, most work.

## Consequences

- **Overrides "keep every commit's own dot visible."** A far-right dot in a deeply expanded region can be occluded behind the metadata. This is accepted because merges are Collapsed by default (dots sit near the left in the common case — see ADR 0004), and because the *outermost* expand control of any expansion chain always sits on a visible Mainline, so a region can always be re-collapsed even when an inner dot is hidden.
- The pinned metadata layer is `pointer-events: none` so row clicks (selection, context menu) pass through to the row beneath.
- The commit message is occluded, not ellipsis-truncated, at the metadata edge; an optional fade at that boundary is a polish detail, not a requirement.

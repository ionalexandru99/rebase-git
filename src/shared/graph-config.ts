export const LOG_PAGE_SIZE = 2_000
export const GRAPH_LAYOUT_DEBOUNCE_MS = 250
export const GRAPH_LAYOUT_MAX_DEBOUNCE_MS = 1_000
// Every republished log costs one pass over the loaded commits per derived view, so the coalescing
// window widens with the log: a small log still updates four times a second, a huge one stops
// spending a frame budget on work the next chunk will redo anyway.
export const GRAPH_LAYOUT_COMMITS_PER_MS = 40

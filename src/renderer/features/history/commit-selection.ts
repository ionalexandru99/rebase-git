// An ordered selection plus an anchor, not a set: order and contiguity are what a future
// squash/range action will consume, and the anchor is what shift-click extends from.
export interface CommitSelection {
  readonly shas: readonly string[]
  readonly anchor: string | null
}

export const EMPTY_COMMIT_SELECTION: CommitSelection = { shas: [], anchor: null }

export interface SelectionModifiers {
  /** Cmd/Ctrl — add or remove the clicked commit on its own. */
  readonly toggle: boolean
  /** Shift — take the contiguous run between the anchor and the clicked commit. */
  readonly range: boolean
}

export interface CommitDetailsState {
  readonly panelOpen: boolean
  readonly selection: CommitSelection
}

function inTimelineOrder(shas: Iterable<string>, orderedShas: readonly string[]): string[] {
  const wanted = new Set(shas)
  return orderedShas.filter((sha) => wanted.has(sha))
}

export function selectCommit(
  current: CommitSelection,
  clickedSha: string,
  modifiers: SelectionModifiers,
  orderedShas: readonly string[]
): CommitSelection {
  const clickedIndex = orderedShas.indexOf(clickedSha)
  const anchorIndex = current.anchor === null ? -1 : orderedShas.indexOf(current.anchor)

  if (modifiers.range && clickedIndex !== -1 && anchorIndex !== -1) {
    const from = Math.min(anchorIndex, clickedIndex)
    const to = Math.max(anchorIndex, clickedIndex)
    const run = orderedShas.slice(from, to + 1)
    const shas = modifiers.toggle ? inTimelineOrder([...current.shas, ...run], orderedShas) : run
    return { shas, anchor: current.anchor }
  }

  if (modifiers.toggle) {
    const next = new Set(current.shas)
    if (next.has(clickedSha)) {
      next.delete(clickedSha)
    } else {
      next.add(clickedSha)
    }
    return { shas: inTimelineOrder(next, orderedShas), anchor: clickedSha }
  }

  return { shas: [clickedSha], anchor: clickedSha }
}

// Filtering, collapsing a merge or streaming a new page can take a selected row off screen; the
// selection follows what is actually displayed so the panel never points at an invisible commit.
export function pruneCommitSelection(
  current: CommitSelection,
  orderedShas: readonly string[]
): CommitSelection {
  const displayed = new Set(orderedShas)
  const shas = current.shas.filter((sha) => displayed.has(sha))
  const anchor = current.anchor !== null && displayed.has(current.anchor) ? current.anchor : null
  if (shas.length === current.shas.length && anchor === current.anchor) {
    return current
  }
  return { shas, anchor }
}

// Two-stage dismissal: the first Esc gives the graph its height back, the second one gives up a
// carefully assembled multi-selection. Returns null when there is nothing left to dismiss, so the
// caller can leave the key event to whatever else is listening.
export function escapeCommitDetails(state: CommitDetailsState): CommitDetailsState | null {
  if (state.panelOpen) {
    return { panelOpen: false, selection: state.selection }
  }
  if (state.selection.shas.length > 0 || state.selection.anchor !== null) {
    return { panelOpen: false, selection: EMPTY_COMMIT_SELECTION }
  }
  return null
}

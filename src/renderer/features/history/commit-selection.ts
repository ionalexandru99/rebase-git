export interface CommitSelection {
  readonly shas: readonly string[]
  readonly anchor: string | null
}

export const EMPTY_COMMIT_SELECTION: CommitSelection = { shas: [], anchor: null }

export interface SelectionModifiers {
  readonly toggle: boolean
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

export function escapeCommitDetails(state: CommitDetailsState): CommitDetailsState | null {
  if (state.panelOpen) {
    return { panelOpen: false, selection: state.selection }
  }
  if (state.selection.shas.length > 0 || state.selection.anchor !== null) {
    return { panelOpen: false, selection: EMPTY_COMMIT_SELECTION }
  }
  return null
}

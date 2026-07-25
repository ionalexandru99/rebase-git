import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStableCallback } from '@/hooks/useStableCallback'
import {
  type CommitSelection,
  EMPTY_COMMIT_SELECTION,
  escapeCommitDetails,
  pruneCommitSelection,
  type SelectionModifiers,
  selectCommit
} from '../commit-selection'

export interface CommitDetailsView {
  detailsOpen: boolean
  selection: CommitSelection
  selectedShas: ReadonlySet<string>
  selectCommit: (sha: string, modifiers: SelectionModifiers) => void
  openDetails: (sha: string) => void
  toggleDetails: () => void
  closeDetails: () => void
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  )
}

/**
 * Selection and panel visibility for the commit-details panel. This is view state, not repo state:
 * it lives with the panel so it resets when the tab or view goes away, and never reaches the git
 * store. `orderedShas` is the displayed timeline, newest first — it defines what a range covers.
 */
export function useCommitDetailsView(
  repoPath: string | null | undefined,
  orderedShas: readonly string[]
): CommitDetailsView {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [selection, setSelection] = useState<CommitSelection>(EMPTY_COMMIT_SELECTION)
  const [lastRepoPath, setLastRepoPath] = useState(repoPath)

  // Opening a different repo in this tab keeps the panel mounted, so the reset has to be explicit.
  if (lastRepoPath !== repoPath) {
    setLastRepoPath(repoPath)
    setDetailsOpen(false)
    setSelection(EMPTY_COMMIT_SELECTION)
  }

  const hasSelection = selection.shas.length > 0 || selection.anchor !== null

  useEffect(() => {
    if (!hasSelection) {
      return
    }
    setSelection((current) => pruneCommitSelection(current, orderedShas))
  }, [hasSelection, orderedShas])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || isTextEntry(event.target)) {
        return
      }
      const next = escapeCommitDetails({ panelOpen: detailsOpen, selection })
      if (!next) {
        return
      }
      event.preventDefault()
      setDetailsOpen(next.panelOpen)
      setSelection(next.selection)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [detailsOpen, selection])

  // Stable identities: these go to memoised commit rows, and `orderedShas` changes on every streamed
  // page — a fresh closure per render would re-render every visible row for nothing.
  const select = useStableCallback((sha: string, modifiers: SelectionModifiers) => {
    setSelection((current) => selectCommit(current, sha, modifiers, orderedShas))
  })

  const openDetails = useStableCallback((sha: string) => {
    select(sha, { toggle: false, range: false })
    setDetailsOpen(true)
  })

  const toggleDetails = useCallback(() => setDetailsOpen((open) => !open), [])
  const closeDetails = useCallback(() => setDetailsOpen(false), [])
  const selectedShas = useMemo(() => new Set(selection.shas), [selection.shas])

  return {
    detailsOpen,
    selection,
    selectedShas,
    selectCommit: select,
    openDetails,
    toggleDetails,
    closeDetails
  }
}

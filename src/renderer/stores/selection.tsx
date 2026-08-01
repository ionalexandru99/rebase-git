import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react'
import {
  type CommitSelection,
  EMPTY_COMMIT_SELECTION,
  pruneCommitSelection,
  type SelectionModifiers,
  selectCommit
} from '@/features/history/commit-selection'
import { useStableCallback } from '@/hooks/useStableCallback'

export type DetailSelection =
  | { readonly kind: 'working-copy' }
  | { readonly kind: 'commits'; readonly shas: readonly string[]; readonly anchor: string | null }
  | null

export interface DetailSelectionStore {
  selection: DetailSelection
  selectedShas: ReadonlySet<string>
  workingCopySelected: boolean
  selectCommitAt: (
    sha: string,
    modifiers: SelectionModifiers,
    orderedShas: readonly string[]
  ) => void
  selectWorkingCopy: () => void
  clearSelection: () => void
  pruneToCommits: (orderedShas: readonly string[]) => void
}

const DetailSelectionContext = createContext<DetailSelectionStore | null>(null)

const EMPTY_SHAS: ReadonlySet<string> = new Set()

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

function commitsOrNull(selection: CommitSelection): DetailSelection {
  if (selection.shas.length === 0 && selection.anchor === null) {
    return null
  }
  return { kind: 'commits', shas: selection.shas, anchor: selection.anchor }
}

export function DetailSelectionProvider(props: { repoPath?: string | null; children: ReactNode }) {
  const [selection, setSelection] = useState<DetailSelection>(null)
  const [lastRepoPath, setLastRepoPath] = useState(props.repoPath)

  if (lastRepoPath !== props.repoPath) {
    setLastRepoPath(props.repoPath)
    setSelection(null)
  }

  const clearSelection = useStableCallback(() => setSelection(null))

  const selectWorkingCopy = useStableCallback(() => setSelection({ kind: 'working-copy' }))

  const selectCommitAt = useStableCallback(
    (sha: string, modifiers: SelectionModifiers, orderedShas: readonly string[]) => {
      setSelection((current) => {
        const base: CommitSelection =
          current?.kind === 'commits'
            ? { shas: current.shas, anchor: current.anchor }
            : EMPTY_COMMIT_SELECTION
        return commitsOrNull(selectCommit(base, sha, modifiers, orderedShas))
      })
    }
  )

  const pruneToCommits = useStableCallback((orderedShas: readonly string[]) => {
    setSelection((current) => {
      if (current?.kind !== 'commits') {
        return current
      }
      const pruned = pruneCommitSelection(
        { shas: current.shas, anchor: current.anchor },
        orderedShas
      )
      if (pruned.shas === current.shas && pruned.anchor === current.anchor) {
        return current
      }
      return commitsOrNull(pruned)
    })
  })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || isTextEntry(event.target)) {
        return
      }
      setSelection((current) => {
        if (current === null) {
          return current
        }
        event.preventDefault()
        return null
      })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const value = useMemo<DetailSelectionStore>(
    () => ({
      selection,
      selectedShas: selection?.kind === 'commits' ? new Set(selection.shas) : EMPTY_SHAS,
      workingCopySelected: selection?.kind === 'working-copy',
      selectCommitAt,
      selectWorkingCopy,
      clearSelection,
      pruneToCommits
    }),
    [selection, selectCommitAt, selectWorkingCopy, clearSelection, pruneToCommits]
  )

  return (
    <DetailSelectionContext.Provider value={value}>
      {props.children}
    </DetailSelectionContext.Provider>
  )
}

export function useDetailSelection(): DetailSelectionStore {
  const value = useContext(DetailSelectionContext)
  if (!value) {
    throw new Error('useDetailSelection must be used within a DetailSelectionProvider')
  }
  return value
}

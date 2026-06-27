import { useMemo, useState } from 'react'
import { computeBranchFilterSet, refFilterKey } from '@/components/HistoryPanel/selectors'
import type { RefKind } from '@/lib/ref-tree'
import { effectiveVisibleTimelineRefs, toggleVisibleTimelineRef } from '@/lib/timeline-visible-refs'
import { useCommitHistory } from '@/stores/commit-history'
import { useRefs } from '@/stores/refs'
import { useRepoSession } from '@/stores/repo-session'
import type { GitLogEntry } from '@/types'

export interface TimelineVisibility {
  visibleRefs: ReadonlySet<string>
  filteredCommits: GitLogEntry[]
  toggle: (refKind: RefKind, fullPath: string) => void
  isVisible: (refKind: RefKind, fullPath: string) => boolean
}

const EMPTY_BRANCH_NAMES: string[] = []
const EMPTY_COMMITS: GitLogEntry[] = []

export function useTimelineVisibility(): TimelineVisibility {
  const { repoPath } = useRepoSession()
  const { branches, currentBranch, defaultBranch, remotes } = useRefs()
  const { log } = useCommitHistory()
  const localBranches = branches?.all ?? EMPTY_BRANCH_NAMES
  const remoteBranches = branches?.remotes ?? EMPTY_BRANCH_NAMES
  const commits = log?.all ?? EMPTY_COMMITS

  const [selectedRefs, setSelectedRefs] = useState<ReadonlySet<string>>(new Set())
  const [selectionRepoPath, setSelectionRepoPath] = useState(repoPath)

  if (selectionRepoPath !== repoPath) {
    setSelectionRepoPath(repoPath)
    setSelectedRefs(new Set())
  }

  const remoteNames = useMemo(() => new Set(Object.keys(remotes)), [remotes])

  const visibleRefs = useMemo(
    () =>
      effectiveVisibleTimelineRefs(
        selectedRefs,
        localBranches,
        remoteBranches,
        defaultBranch,
        currentBranch,
        remoteNames
      ),
    [selectedRefs, localBranches, remoteBranches, defaultBranch, currentBranch, remoteNames]
  )

  const filteredCommits = useMemo(() => {
    if (visibleRefs.size === 0) {
      return EMPTY_COMMITS
    }
    const reachable = computeBranchFilterSet(commits, visibleRefs, remoteBranches, remoteNames)
    if (!reachable || reachable.size === 0) {
      return EMPTY_COMMITS
    }
    return commits.filter((commit) => reachable.has(commit.hash))
  }, [commits, visibleRefs, remoteBranches, remoteNames])

  const toggle = (refKind: RefKind, fullPath: string) => {
    if (refKind === 'tag') {
      return
    }
    const key = refFilterKey(refKind, fullPath)
    setSelectedRefs((previous) =>
      toggleVisibleTimelineRef(
        effectiveVisibleTimelineRefs(
          previous,
          localBranches,
          remoteBranches,
          defaultBranch,
          currentBranch,
          remoteNames
        ),
        key,
        localBranches,
        remoteBranches,
        defaultBranch,
        currentBranch,
        remoteNames
      )
    )
  }

  const isVisible = (refKind: RefKind, fullPath: string): boolean =>
    visibleRefs.has(refFilterKey(refKind, fullPath))

  return { visibleRefs, filteredCommits, toggle, isVisible }
}

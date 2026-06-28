import { useDeferredValue, useMemo, useState } from 'react'
import {
  collectTimelineTips,
  computeCollapsedView,
  computeMergesToReveal,
  computeVisibleSet,
  refFilterKey
} from '@/components/HistoryPanel/selectors'
import type { RefKind } from '@/lib/ref-tree'
import { effectiveVisibleTimelineRefs, toggleVisibleTimelineRef } from '@/lib/timeline-visible-refs'
import { useCommitHistory } from '@/stores/commit-history'
import { useRefs } from '@/stores/refs'
import { useRepoSession } from '@/stores/repo-session'
import type { GitLogEntry } from '@/types'

export interface TimelineVisibility {
  visibleRefs: ReadonlySet<string>
  filteredCommits: GitLogEntry[]
  expandedMerges: ReadonlySet<string>
  filter: string
  setFilter: (value: string) => void
  visibleSet: Set<string> | null
  toggle: (refKind: RefKind, fullPath: string) => void
  toggleMergeExpansion: (mergeHash: string) => void
  isVisible: (refKind: RefKind, fullPath: string) => boolean
}

const EMPTY_BRANCH_NAMES: string[] = []
const EMPTY_COMMITS: GitLogEntry[] = []
const EMPTY_TIPS: string[] = []

export function useTimelineVisibility(): TimelineVisibility {
  const { repoPath } = useRepoSession()
  const { branches, currentBranch, defaultBranch, remotes } = useRefs()
  const { log } = useCommitHistory()
  const localBranches = branches?.all ?? EMPTY_BRANCH_NAMES
  const remoteBranches = branches?.remotes ?? EMPTY_BRANCH_NAMES
  const commits = log?.all ?? EMPTY_COMMITS

  const [selectedRefs, setSelectedRefs] = useState<ReadonlySet<string>>(new Set())
  const [expandedMerges, setExpandedMerges] = useState<ReadonlySet<string>>(new Set())
  const [filter, setFilter] = useState('')
  const deferredFilter = useDeferredValue(filter)
  const [selectionRepoPath, setSelectionRepoPath] = useState(repoPath)

  if (selectionRepoPath !== repoPath) {
    setSelectionRepoPath(repoPath)
    setSelectedRefs(new Set())
    setExpandedMerges(new Set())
    setFilter('')
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

  const tips = useMemo(() => {
    if (visibleRefs.size === 0) {
      return EMPTY_TIPS
    }
    return collectTimelineTips(commits, visibleRefs, remoteBranches, remoteNames)
  }, [commits, visibleRefs, remoteBranches, remoteNames])

  const visibleSet = useMemo(
    () => computeVisibleSet(deferredFilter, commits),
    [deferredFilter, commits]
  )

  // Auto-reveal merges hide nothing the user chose to collapse: search expands a derived union, the
  // manual `expandedMerges` state stays untouched, so clearing the query restores it exactly.
  const effectiveExpandedMerges = useMemo(() => {
    if (!visibleSet || tips.length === 0) {
      return expandedMerges
    }
    const revealed = computeMergesToReveal(commits, tips, visibleSet)
    if (revealed.size === 0) {
      return expandedMerges
    }
    const merged = new Set(expandedMerges)
    for (const mergeHash of revealed) {
      merged.add(mergeHash)
    }
    return merged
  }, [commits, tips, visibleSet, expandedMerges])

  const filteredCommits = useMemo(() => {
    if (tips.length === 0) {
      return EMPTY_COMMITS
    }
    const displayed = computeCollapsedView(commits, tips, effectiveExpandedMerges)
    if (displayed.size === 0) {
      return EMPTY_COMMITS
    }
    return commits.filter((commit) => displayed.has(commit.hash))
  }, [commits, tips, effectiveExpandedMerges])

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

  const toggleMergeExpansion = (mergeHash: string) => {
    setExpandedMerges((previous) => {
      const next = new Set(previous)
      if (next.has(mergeHash)) {
        next.delete(mergeHash)
      } else {
        next.add(mergeHash)
      }
      return next
    })
  }

  const isVisible = (refKind: RefKind, fullPath: string): boolean =>
    visibleRefs.has(refFilterKey(refKind, fullPath))

  return {
    visibleRefs,
    filteredCommits,
    expandedMerges: effectiveExpandedMerges,
    filter,
    setFilter,
    visibleSet,
    toggle,
    toggleMergeExpansion,
    isVisible
  }
}

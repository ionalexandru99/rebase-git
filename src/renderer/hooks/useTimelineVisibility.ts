import { GRAPH_LAYOUT_DEBOUNCE_MS } from '@shared/graph-config'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
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
  displayedCommitSet: ReadonlySet<string>
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
const EMPTY_COMMIT_SET: ReadonlySet<string> = new Set()

export function useCoalescedCommitSnapshot(
  commits: GitLogEntry[],
  streaming: boolean,
  enabled: boolean
): GitLogEntry[] {
  const source = enabled ? commits : EMPTY_COMMITS
  const [snapshot, setSnapshot] = useState(source)
  const pending = useRef(source)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  pending.current = source

  useEffect(() => {
    if (!streaming) {
      if (timer.current !== null) {
        clearTimeout(timer.current)
        timer.current = null
      }
      setSnapshot(source)
      return
    }
    if (timer.current === null) {
      timer.current = setTimeout(() => {
        timer.current = null
        setSnapshot(pending.current)
      }, GRAPH_LAYOUT_DEBOUNCE_MS)
    }
  }, [source, streaming])

  useEffect(() => {
    return () => {
      if (timer.current !== null) {
        clearTimeout(timer.current)
      }
    }
  }, [])

  return enabled ? snapshot : EMPTY_COMMITS
}

export function useTimelineVisibility(enabled = true): TimelineVisibility {
  const { repoPath } = useRepoSession()
  const { branches, currentBranch, defaultBranch, remotes } = useRefs()
  const { log, logLoading, logLoadingMore } = useCommitHistory()
  const localBranches = branches?.all ?? EMPTY_BRANCH_NAMES
  const remoteBranches = branches?.remotes ?? EMPTY_BRANCH_NAMES
  const loadedCommits = log?.all ?? EMPTY_COMMITS
  const commits = useCoalescedCommitSnapshot(loadedCommits, logLoading || logLoadingMore, enabled)

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
    if (!enabled) {
      return EMPTY_TIPS
    }
    return collectTimelineTips(commits, visibleRefs, remoteBranches, remoteNames, currentBranch)
  }, [enabled, commits, visibleRefs, remoteBranches, remoteNames, currentBranch])

  const visibleSet = useMemo(
    () => (enabled ? computeVisibleSet(deferredFilter, commits) : null),
    [enabled, deferredFilter, commits]
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

  const collapsedView = useMemo(() => {
    if (!enabled || tips.length === 0) {
      return { commits: EMPTY_COMMITS, displayed: EMPTY_COMMIT_SET }
    }
    const displayed = computeCollapsedView(commits, tips, effectiveExpandedMerges)
    if (displayed.size === 0) {
      return { commits: EMPTY_COMMITS, displayed }
    }
    return { commits: commits.filter((commit) => displayed.has(commit.hash)), displayed }
  }, [enabled, commits, tips, effectiveExpandedMerges])

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
    filteredCommits: collapsedView.commits,
    displayedCommitSet: collapsedView.displayed,
    expandedMerges: effectiveExpandedMerges,
    filter,
    setFilter,
    visibleSet,
    toggle,
    toggleMergeExpansion,
    isVisible
  }
}

import {
  GRAPH_LAYOUT_COMMITS_PER_MS,
  GRAPH_LAYOUT_DEBOUNCE_MS,
  GRAPH_LAYOUT_MAX_DEBOUNCE_MS
} from '@shared/graph-config'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  collectTimelineTips,
  computeCollapsedView,
  computeMergesToReveal,
  computeVisibleSet,
  refFilterKey
} from '@/features/history/selectors'
import { useCommitHistory } from '@/features/history/store'
import {
  effectiveVisibleTimelineRefs,
  toggleVisibleTimelineRef
} from '@/features/history/timeline-visible-refs'
import type { RefKind } from '@/features/refs/ref-tree'
import { useRefs } from '@/features/refs/store'
import { useRepoSession } from '@/stores/repo-session'
import type { GitLogEntry } from '@/types'

export interface TimelineVisibility {
  visibleRefs: ReadonlySet<string>
  graphCommits: GitLogEntry[]
  timelineTips: readonly string[]
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

export function coalesceDelayFor(commitCount: number): number {
  return Math.min(
    GRAPH_LAYOUT_MAX_DEBOUNCE_MS,
    Math.max(GRAPH_LAYOUT_DEBOUNCE_MS, Math.round(commitCount / GRAPH_LAYOUT_COMMITS_PER_MS))
  )
}

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
      }, coalesceDelayFor(source.length))
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

  const toggle = useCallback(
    (refKind: RefKind, fullPath: string) => {
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
    },
    [localBranches, remoteBranches, defaultBranch, currentBranch, remoteNames]
  )

  const toggleMergeExpansion = useCallback((mergeHash: string) => {
    setExpandedMerges((previous) => {
      const next = new Set(previous)
      if (next.has(mergeHash)) {
        next.delete(mergeHash)
      } else {
        next.add(mergeHash)
      }
      return next
    })
  }, [])

  const isVisible = useCallback(
    (refKind: RefKind, fullPath: string): boolean =>
      visibleRefs.has(refFilterKey(refKind, fullPath)),
    [visibleRefs]
  )

  return useMemo(
    () => ({
      visibleRefs,
      graphCommits: commits,
      timelineTips: tips,
      filteredCommits: collapsedView.commits,
      displayedCommitSet: collapsedView.displayed,
      expandedMerges: effectiveExpandedMerges,
      filter,
      setFilter,
      visibleSet,
      toggle,
      toggleMergeExpansion,
      isVisible
    }),
    [
      visibleRefs,
      commits,
      tips,
      collapsedView,
      effectiveExpandedMerges,
      filter,
      visibleSet,
      toggle,
      toggleMergeExpansion,
      isVisible
    ]
  )
}

import { useCallback, useMemo } from 'react'
import type { CommitAction } from '@/lib/git-actions'
import type { GitLog, GitLogEntry } from '@/types'
import type { SelectionModifiers } from './commit-selection'
import { HistoryViewport } from './HistoryViewport'
import { useGraphLayout } from './hooks/useGraphLayout'
import { useGraphMetrics } from './hooks/useGraphMetrics'
import {
  computeMergeSideRangeIndex,
  computeOnBranchSet,
  getCommitIndex,
  getRefTipIndex
} from './selectors'

interface HistoryPanelProps {
  log: GitLog | null
  loading: boolean
  loadingMore?: boolean
  hasMore?: boolean
  onLoadMore?: () => void
  remotes?: Record<string, string>
  currentBranch?: string
  graphCommits?: GitLogEntry[]
  filteredCommits?: GitLogEntry[]
  displayedCommitSet?: ReadonlySet<string>
  timelineTips?: readonly string[]
  expandedMerges?: ReadonlySet<string>
  visibleSet?: Set<string> | null
  onToggleMergeExpansion?: (mergeHash: string) => void
  onCommitAction?: (action: CommitAction, sha: string, message: string) => void
  selectedShas?: ReadonlySet<string>
  onSelectCommit?: (sha: string, modifiers: SelectionModifiers) => void
  onSelectWorkingCopy?: () => void
  workingCopySelected?: boolean
  repoPath?: string | null
}

const EMPTY_COMMITS: GitLogEntry[] = []
const EMPTY_REMOTES: Record<string, string> = {}
const EMPTY_REF_SET: ReadonlySet<string> = new Set()
const EMPTY_SHAS: ReadonlySet<string> = new Set()
const EMPTY_TIPS: readonly string[] = []

export function HistoryPanel(props: HistoryPanelProps) {
  const metrics = useGraphMetrics()
  const visibleSet = props.visibleSet ?? null
  const remotes = props.remotes ?? EMPTY_REMOTES
  const remoteNames = useMemo(() => new Set(Object.keys(remotes)), [remotes])

  const allCommits = props.log?.all ?? EMPTY_COMMITS
  const graphCommits = props.graphCommits ?? allCommits
  const expandedMerges = props.expandedMerges ?? EMPTY_REF_SET
  const commits = props.filteredCommits ?? EMPTY_COMMITS
  const timelineTips = props.timelineTips ?? EMPTY_TIPS

  const displayedSet = useMemo(
    () => props.displayedCommitSet ?? new Set(commits.map((commit) => commit.hash)),
    [props.displayedCommitSet, commits]
  )
  const mergeSideRanges = useMemo(
    () =>
      computeMergeSideRangeIndex(graphCommits, commits, displayedSet, expandedMerges, timelineTips),
    [graphCommits, commits, displayedSet, expandedMerges, timelineTips]
  )

  const loadedCommits = useMemo(() => getCommitIndex(graphCommits).byHash, [graphCommits])
  const isHiddenParent = useCallback(
    (hash: string) => loadedCommits.has(hash) && !displayedSet.has(hash),
    [loadedCommits, displayedSet]
  )
  const displayedPositions = useMemo(() => getCommitIndex(commits).positionByHash, [commits])
  const rowOf = useCallback((hash: string) => displayedPositions.get(hash), [displayedPositions])

  const currentBranch = props.currentBranch
  const onCurrentBranchSet = useMemo(
    () => computeOnBranchSet(graphCommits, remoteNames, currentBranch),
    [graphCommits, remoteNames, currentBranch]
  )

  const graph = useGraphLayout({
    commits,
    enabled: commits.length > 0,
    rowOf,
    isHiddenParent
  })

  const headRow = useMemo(() => {
    const headTip = getRefTipIndex(commits, remoteNames).headTip
    const row = headTip === undefined ? undefined : displayedPositions.get(headTip)
    return row === undefined ? 0 : row
  }, [commits, displayedPositions, remoteNames])

  const hasCommits = allCommits.length > 0
  const showSkeleton = props.loading && !hasCommits

  const orderedShas = useMemo(() => commits.map((commit) => commit.hash), [commits])

  return (
    <div className="flex h-full min-h-0 flex-col" data-history-panel="">
      <HistoryViewport
        commits={commits}
        layout={graph.layout}
        topology={graph.topology}
        validRows={graph.validRows}
        metrics={metrics}
        orderedShas={orderedShas}
        headRow={headRow}
        loadedCount={allCommits.length}
        hasLog={props.log !== null}
        loading={props.loading}
        loadingMore={props.loadingMore}
        hasMore={props.hasMore}
        onLoadMore={props.onLoadMore}
        repoPath={props.repoPath}
        visibleSet={visibleSet}
        mergeSideRanges={mergeSideRanges}
        onCurrentBranchSet={onCurrentBranchSet}
        remotes={remotes}
        remoteNames={remoteNames}
        onToggleMergeExpansion={props.onToggleMergeExpansion}
        onCommitAction={props.onCommitAction}
        onSelectWorkingCopy={props.onSelectWorkingCopy}
        workingCopySelected={props.workingCopySelected}
        showSkeleton={showSkeleton}
        hasCommits={hasCommits}
        selectedShas={props.selectedShas ?? EMPTY_SHAS}
        onSelectCommit={props.onSelectCommit}
      />
    </div>
  )
}

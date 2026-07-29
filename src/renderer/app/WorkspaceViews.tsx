import { type ComponentType, type ReactElement, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  assembleDrops,
  dropStateOf,
  type FileDrops,
  hunkDropped,
  toggleFileDrop,
  toggleHunkDrop
} from '../features/commit/amend-drops'
import { CommitPanel } from '../features/commit/CommitPanel'
import { DiffPanel } from '../features/diff/DiffPanel'
import { HistoryPanel } from '../features/history'
import { buildHeadCommitRange } from '../features/history/head-commit-range'
import type { RefKind } from '../features/refs/ref-tree'
import { CleanWorkingTree } from '../features/status/CleanWorkingTree'
import { ConflictBanner } from '../features/status/ConflictBanner'
import type { ConflictSide } from '../features/status/conflict-resolution'
import { type OperationSummary, summarizeOperation } from '../features/status/operation-summary'
import { StashControl } from '../features/status/StashControl'
import { type SelectedFile, StatusPanel } from '../features/status/StatusPanel'
import { buildHeadCommitRows, buildStagedFilePaths } from '../features/status/status-file-rows'
import { useDraggablePane } from '../hooks/useDraggablePane'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { COMPACT_MEDIA_QUERY } from '../lib/breakpoints'
import type { CommitAction, FileAction } from '../lib/git-actions'
import { cn } from '../lib/utils'
import type { WorkspaceView } from '../shell/Topbar'
import {
  useActionRunner,
  useCommitHistory,
  useHeadCommit,
  useRepoSession,
  useWorkingTreeStatus
} from '../stores/git'
import type { GitLogEntry } from '../types'
import { useWorkspaceContext } from './WorkspaceContext'

const FILES_PANEL_WIDTH_MIN = 240
const FILES_PANEL_WIDTH_MAX = 620
const FILES_PANEL_WIDTH_DEFAULT = 320
const FILES_PANEL_WIDTH_KEY = 'rebase:local-files-width'

const loadFilesPanelWidth = async () => {
  const stored = Number(localStorage.getItem(FILES_PANEL_WIDTH_KEY))
  return {
    open: true,
    size: Number.isFinite(stored) && stored > 0 ? stored : FILES_PANEL_WIDTH_DEFAULT
  }
}

const saveFilesPanelWidth = (state: { size: number }) => {
  try {
    localStorage.setItem(FILES_PANEL_WIDTH_KEY, String(state.size))
  } catch {}
}

interface WorkspaceViewProps {
  repoPath: string | null
  remotes: Record<string, string>
  currentBranch: string
  remoteBranches: string[]
  visibleBranchRefs: ReadonlySet<string>
  filteredCommits: GitLogEntry[]
  displayedCommitSet: ReadonlySet<string>
  expandedMerges: ReadonlySet<string>
  filter: string
  onFilterChange: (value: string) => void
  visibleSet: Set<string> | null
  graphCommits?: GitLogEntry[]
  timelineTips?: readonly string[]
  onToggleMergeExpansion?: (mergeHash: string) => void
  onToggleTimelineVisibility?: (refKind: RefKind, fullPath: string) => void
  onCommitAction?: (action: CommitAction, sha: string, message: string) => void
  tabActive: boolean
}

function LocalChangesView(props: WorkspaceViewProps) {
  const { status, rows, statusState, stageFile, unstageFile } = useWorkingTreeStatus()
  const { commit, amend, loadHeadMessage, busy } = useActionRunner()
  const { opening } = useRepoSession()
  const history = useCommitHistory()
  const loading = opening || busy
  const { actions, prompt, confirm } = useWorkspaceContext()
  const [selected, setSelected] = useState<SelectedFile | null>(null)
  const [amendActive, setAmendActive] = useState(false)
  const [compactPane, setCompactPane] = useState<'files' | 'diff'>('files')
  const compact = useMediaQuery(COMPACT_MEDIA_QUERY)
  const [drops, setDrops] = useState<FileDrops>(() => new Map())
  const headCommit = useHeadCommit(amendActive)
  const headFiles = headCommit.data?.files ?? []
  const headParentCount = headCommit.data?.parentCount ?? 0
  const amendRows = useMemo(
    () => (amendActive && headParentCount <= 1 ? buildHeadCommitRows(headFiles, drops) : []),
    [amendActive, headParentCount, headFiles, drops]
  )
  const { droppedHeadPaths, droppedHeadHunks } = useMemo(
    () => assembleDrops(drops, amendRows),
    [amendRows, drops]
  )

  const promptStash = (title: string, run: (message?: string) => Promise<boolean>) => {
    prompt({
      title,
      label: 'Message (optional)',
      placeholder: 'Describe these changes',
      confirmText: 'Stash',
      allowEmpty: true,
      onConfirm: (message) => void run(message.trim() || undefined)
    })
  }

  const stashSelected = (files: string[]) => {
    if (files.length === 0) {
      return
    }
    promptStash('Stash selected changes', (message) => actions.stashPush(message, true, files))
  }

  const stashAll = () => {
    promptStash('Stash all changes', (message) => actions.stashPush(message, true))
  }

  const handleFileAction = (action: FileAction, file: string, renameSource?: string) => {
    switch (action) {
      case 'stage':
        void stageFile(file)
        return
      case 'unstage':
        void unstageFile(file, renameSource)
        return
      case 'discard':
        confirm({
          title: `Discard changes to ${file}?`,
          message: 'Local edits to this file are lost. Untracked files are deleted.',
          confirmText: 'Discard',
          destructive: true,
          onConfirm: () =>
            void actions.discardChanges(
              renameSource ? [renameSource, file] : [file],
              `Discarded ${file}`
            )
        })
        return
      case 'copy-path':
        void navigator.clipboard
          .writeText(file)
          .then(() => toast.success('Copied path'))
          .catch(() => toast.error('Copy failed'))
        return
    }
  }

  const resolveConflict = (file: string, side: ConflictSide) => {
    void actions.resolveConflict(file, side)
  }

  const requestAbortOperation = (summary: OperationSummary) => {
    confirm({
      title: summary.confirmTitle,
      message: summary.confirmMessage,
      confirmText: summary.abortText,
      destructive: true,
      onConfirm: () => void actions.abortOperation(summary.noun)
    })
  }

  // A bare reset --hard ends a merge but leaves a rebase or sequencer mid-flight, so discarding
  // during an operation aborts it properly first — and the confirm says so instead of letting a
  // merge die silently.
  const discardAll = () => {
    const summary = status?.operation ? summarizeOperation(status.operation) : null
    confirm({
      title: 'Discard all changes?',
      message: summary
        ? `Every uncommitted change in the working tree is permanently lost, and the in-progress ${summary.noun} is aborted.`
        : 'Every uncommitted change in the working tree is permanently lost.',
      confirmText: 'Discard all',
      destructive: true,
      onConfirm: () => {
        void (async () => {
          if (summary) {
            const aborted = await actions.abortOperation(summary.noun)
            if (!aborted) {
              return
            }
          }
          await actions.discardAll()
        })()
      }
    })
  }
  const { size: filesWidth, onResizeStart } = useDraggablePane({
    min: FILES_PANEL_WIDTH_MIN,
    max: FILES_PANEL_WIDTH_MAX,
    defaultSize: FILES_PANEL_WIDTH_DEFAULT,
    load: loadFilesPanelWidth,
    save: saveFilesPanelWidth
  })

  const totalChanges = rows.length
  const stagedCount = rows.filter((row) => row.stageState !== 'unstaged').length
  const hasHeadCommit = (history.log?.all.length ?? 0) > 0
  const headAvailabilityLoading = history.logLoading && !hasHeadCommit
  const amendAvailable = hasHeadCommit || headAvailabilityLoading
  const conflictCount = status?.conflicted.length ?? 0
  const operation = status?.operation
  // The conflict count falls to zero as soon as the last file is resolved, but the operation runs
  // until Continue finishes it — and git refuses to amend for the whole of it.
  const amendDisabled = headAvailabilityLoading || conflictCount > 0 || operation !== undefined
  const operationSummary = operation ? summarizeOperation(operation) : null
  const commitBlockedReason = conflictBlockedReason(conflictCount, operationSummary)

  const fileEntries = useMemo<SelectedFile[]>(
    () => rows.map((row) => ({ file: row.file, renameSource: row.renameSource })),
    [rows]
  )

  const stagedFiles = useMemo(() => buildStagedFilePaths(rows), [rows])

  useEffect(() => {
    const current = selected
    if (current?.source === 'head-commit') {
      return
    }
    const stillExists = current && fileEntries.some((entry) => entry.file === current.file)
    if (!stillExists) {
      setSelected(fileEntries[0] ?? null)
    }
  }, [fileEntries, selected])

  useEffect(() => {
    if (!compact) {
      setCompactPane('files')
    }
  }, [compact])

  const handleAmendChange = (active: boolean) => {
    setAmendActive(active)
    if (!active) {
      setDrops(new Map())
      setSelected((current) =>
        current?.source === 'head-commit' ? (fileEntries[0] ?? null) : current
      )
    }
  }

  const toggleHeadFileDrop = (file: string) => {
    setDrops((current) => toggleFileDrop(current, file))
  }

  const toggleHeadHunkDrop = (file: string, hunkHeader: string, allHeaders: string[]) => {
    setDrops((current) => toggleHunkDrop(current, file, hunkHeader, allHeaders))
  }

  const selectHeadFile = (file: string, renameSource?: string) => {
    const headSha = headCommit.data?.sha
    if (!headSha) {
      return
    }
    setSelected({
      file,
      renameSource,
      source: 'head-commit',
      range: buildHeadCommitRange(headParentCount, headSha)
    })
    if (compact) {
      setCompactPane('diff')
    }
  }

  const selectWorktreeFile = (file: string, renameSource?: string) => {
    setSelected({ file, renameSource })
    if (compact) {
      setCompactPane('diff')
    }
  }

  const amendDrop =
    selected?.source === 'head-commit'
      ? {
          dropState: dropStateOf(drops, selected.file),
          isHunkDropped: (hunkHeader: string) => hunkDropped(drops, selected.file, hunkHeader),
          onToggleFile: () => toggleHeadFileDrop(selected.file),
          onToggleHunk: (hunkHeader: string, allHeaders: string[]) =>
            toggleHeadHunkDrop(selected.file, hunkHeader, allHeaders)
        }
      : undefined

  if (!status && statusState !== 'ready') {
    return <StatusPanel selected={null} onSelect={() => {}} loading={loading} />
  }

  // A repository with no commits still reaches this branch mid-operation: a `git am --3way` that
  // fails to apply in an unborn repository leaves a patch series parked with an empty porcelain
  // status. Without the banner there is nothing to abort it with, and CleanWorkingTree points at
  // controls "above" that were never rendered.
  if (totalChanges === 0 && !amendAvailable) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <ConflictBanner
          busy={busy}
          onContinue={(noun) => void actions.continueOperation(noun)}
          onAbort={requestAbortOperation}
        />
        <CleanWorkingTree operation={operation} />
      </div>
    )
  }

  return (
    <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] overflow-hidden">
      <div className="flex min-h-0 flex-col overflow-hidden">
        <ConflictBanner
          busy={busy}
          onContinue={(noun) => void actions.continueOperation(noun)}
          onAbort={requestAbortOperation}
        />
        {totalChanges > 0 || amendActive ? (
          <div
            className={cn(
              'grid min-h-0 flex-1 overflow-hidden',
              compact && 'grid-rows-[38px_minmax(0,1fr)]'
            )}
            style={
              compact
                ? undefined
                : {
                    gridTemplateColumns: `min(${filesWidth}px, calc(100% - 300px)) minmax(300px, 1fr)`
                  }
            }
          >
            {compact ? (
              <div className="flex items-center gap-1 border-b bg-card-2 px-2">
                {(['files', 'diff'] as const).map((pane) => (
                  <button
                    key={pane}
                    type="button"
                    aria-pressed={compactPane === pane}
                    onClick={() => setCompactPane(pane)}
                    className={cn(
                      'h-7 rounded-[var(--r-sm)] px-3 text-xs font-medium transition-colors',
                      compactPane === pane
                        ? 'bg-muted text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {pane === 'files' ? 'Files' : 'Diff'}
                  </button>
                ))}
              </div>
            ) : null}
            <div
              className={cn(
                'relative min-h-0 min-w-0 flex-col border-r',
                compact && compactPane !== 'files' ? 'hidden' : 'flex'
              )}
            >
              <div className="min-h-0 flex-1 overflow-hidden">
                <StatusPanel
                  selected={selected}
                  onSelect={(file, source, renameSource) =>
                    source === 'head-commit'
                      ? selectHeadFile(file, renameSource)
                      : selectWorktreeFile(file, renameSource)
                  }
                  onToggleDrop={toggleHeadFileDrop}
                  amendRows={amendRows}
                  onFileAction={handleFileAction}
                  onResolveConflict={resolveConflict}
                  headerActions={
                    totalChanges > 0 ? (
                      <>
                        <StashControl
                          stagedFiles={stagedFiles}
                          stagedCount={stagedCount}
                          hasChanges={totalChanges > 0}
                          busy={busy}
                          blockedReason={
                            operationSummary
                              ? `Finish or abort the ${operationSummary.noun} first.`
                              : undefined
                          }
                          onStashSelected={stashSelected}
                          onStashAll={stashAll}
                        />
                        <button
                          type="button"
                          onClick={discardAll}
                          className="h-7 shrink-0 rounded-[var(--r-sm)] border bg-card-2 px-2.5 text-xs text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive"
                        >
                          Discard all
                        </button>
                      </>
                    ) : undefined
                  }
                  loading={loading}
                />
              </div>
              {!compact ? (
                <span
                  onMouseDown={(event) => onResizeStart(event.nativeEvent)}
                  aria-hidden="true"
                  className="group/files-resize absolute -right-1 top-0 z-30 flex h-full w-2 cursor-col-resize items-stretch justify-center"
                >
                  <span className="w-px bg-border-strong/50 transition-colors group-hover/files-resize:bg-primary/70" />
                </span>
              ) : null}
            </div>
            <div
              className={cn(
                'min-h-0 min-w-0 overflow-hidden',
                compact && compactPane !== 'diff' ? 'hidden' : 'block'
              )}
            >
              <DiffPanel selected={selected} amendDrop={amendDrop} />
            </div>
          </div>
        ) : headAvailabilityLoading ? (
          <div className="min-h-0 flex-1 overflow-hidden">
            <StatusPanel selected={null} onSelect={() => {}} loading={true} />
          </div>
        ) : (
          <CleanWorkingTree operation={operation} />
        )}
      </div>
      <CommitPanel
        onCommit={commit}
        onAmend={amend}
        loadHeadMessage={loadHeadMessage}
        onAmendChange={handleAmendChange}
        droppedHeadPaths={droppedHeadPaths}
        droppedHeadHunks={droppedHeadHunks}
        expectedHead={headCommit.data?.sha}
        amendAvailable={amendAvailable}
        amendDisabled={amendDisabled}
        loading={loading}
        branch={props.currentBranch || 'no-branch'}
        stagedCount={stagedCount}
        prefillMessage={operation?.kind === 'merge' ? operation.mergeMessage : undefined}
        concludesMerge={operation?.kind === 'merge'}
        commitBlockedReason={commitBlockedReason}
      />
    </div>
  )
}

// Committing never finishes a sequencer operation — those end with Continue — and a merge commit
// is refused by git while any file is still conflicted.
function conflictBlockedReason(
  conflictCount: number,
  summary: OperationSummary | null
): string | undefined {
  if (conflictCount > 0) {
    return 'Resolve and stage every conflicted file before committing.'
  }
  if (summary?.canContinue) {
    return `Finish this ${summary.noun} with Continue above, not a commit.`
  }
  return undefined
}

function HistoryView(props: WorkspaceViewProps) {
  const history = useCommitHistory()

  return props.tabActive ? (
    <div className="min-h-0 flex-1 overflow-hidden">
      <HistoryPanel
        log={history.log}
        loading={history.logLoading}
        loadingMore={history.logLoadingMore}
        hasMore={history.logHasMore}
        onLoadMore={() => void history.loadMoreHistory()}
        repoPath={props.repoPath}
        remotes={props.remotes}
        currentBranch={props.currentBranch}
        remoteBranches={props.remoteBranches}
        visibleBranchRefs={props.visibleBranchRefs}
        filteredCommits={props.filteredCommits}
        displayedCommitSet={props.displayedCommitSet}
        expandedMerges={props.expandedMerges}
        filter={props.filter}
        onFilterChange={props.onFilterChange}
        visibleSet={props.visibleSet}
        graphCommits={props.graphCommits}
        timelineTips={props.timelineTips}
        onToggleMergeExpansion={props.onToggleMergeExpansion}
        onToggleTimelineVisibility={props.onToggleTimelineVisibility}
        onCommitAction={props.onCommitAction}
      />
    </div>
  ) : null
}

const workspaceViewComponents = {
  history: HistoryView,
  'local-changes': LocalChangesView
} satisfies Record<WorkspaceView, ComponentType<WorkspaceViewProps>>

interface WorkspaceViewRendererProps extends WorkspaceViewProps {
  activeView: WorkspaceView
}

export function WorkspaceViewRenderer(props: WorkspaceViewRendererProps): ReactElement {
  const View = workspaceViewComponents[props.activeView]
  return <View {...props} />
}

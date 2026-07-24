import { CheckIcon } from 'lucide-react'
import { type ComponentType, type ReactElement, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CommitPanel } from './components/CommitPanel'
import { DiffPanel } from './components/DiffPanel'
import { HistoryPanel } from './components/HistoryPanel'
import { type SelectedFile, StatusPanel } from './components/StatusPanel'
import { StashControl } from './components/StatusPanel/StashControl'
import type { WorkspaceView } from './components/shell/Topbar'
import { useDraggableWidth } from './hooks/useDraggableWidth'
import { useMediaQuery } from './hooks/useMediaQuery'
import {
  assembleDrops,
  dropStateOf,
  type FileDrops,
  hunkDropped,
  toggleFileDrop,
  toggleHunkDrop
} from './lib/amend-drops'
import type { CommitAction, FileAction } from './lib/git-actions'
import { buildHeadCommitRange } from './lib/head-commit-range'
import type { RefKind } from './lib/ref-tree'
import { buildHeadCommitRows, buildStagedFilePaths } from './lib/status-file-rows'
import { cn } from './lib/utils'
import {
  useActionRunner,
  useCommitHistory,
  useHeadCommit,
  useRepoSession,
  useWorkingTreeStatus
} from './stores/git'
import type { GitLogEntry } from './types'
import { useWorkspaceContext } from './WorkspaceContext'

const FILES_PANEL_WIDTH_MIN = 240
const FILES_PANEL_WIDTH_MAX = 620
const FILES_PANEL_WIDTH_DEFAULT = 320
const FILES_PANEL_WIDTH_KEY = 'rebase:local-files-width'

const loadFilesPanelWidth = async () => {
  const stored = Number(localStorage.getItem(FILES_PANEL_WIDTH_KEY))
  return {
    open: true,
    width: Number.isFinite(stored) && stored > 0 ? stored : FILES_PANEL_WIDTH_DEFAULT
  }
}

const saveFilesPanelWidth = (state: { width: number }) => {
  try {
    localStorage.setItem(FILES_PANEL_WIDTH_KEY, String(state.width))
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
  const compact = useMediaQuery('(max-width: 899px)')
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

  const discardAll = () => {
    confirm({
      title: 'Discard all changes?',
      message: 'Every uncommitted change in the working tree is permanently lost.',
      confirmText: 'Discard all',
      destructive: true,
      onConfirm: () => void actions.discardAll()
    })
  }
  const { width: filesWidth, onResizeStart } = useDraggableWidth({
    min: FILES_PANEL_WIDTH_MIN,
    max: FILES_PANEL_WIDTH_MAX,
    defaultWidth: FILES_PANEL_WIDTH_DEFAULT,
    load: loadFilesPanelWidth,
    save: saveFilesPanelWidth
  })

  const totalChanges = rows.length
  const stagedCount = rows.filter((row) => row.stageState !== 'unstaged').length
  const hasHeadCommit = (history.log?.all.length ?? 0) > 0
  const headAvailabilityLoading = history.logLoading && !hasHeadCommit
  const amendAvailable = hasHeadCommit || headAvailabilityLoading
  const amendDisabled = headAvailabilityLoading || (status?.conflicted.length ?? 0) > 0

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

  if (totalChanges === 0 && !amendAvailable) {
    return <CleanWorkingTree />
  }

  return (
    <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] overflow-hidden">
      {totalChanges > 0 || amendActive ? (
        <div
          className={cn(
            'grid min-h-0 overflow-hidden',
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
                headerActions={
                  totalChanges > 0 ? (
                    <>
                      <StashControl
                        stagedFiles={stagedFiles}
                        stagedCount={stagedCount}
                        hasChanges={totalChanges > 0}
                        busy={busy}
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
        <StatusPanel selected={null} onSelect={() => {}} loading={true} />
      ) : (
        <CleanWorkingTree />
      )}
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
      />
    </div>
  )
}

function CleanWorkingTree() {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2.5 text-center text-muted-foreground">
      <span className="flex size-[52px] items-center justify-center rounded-full bg-green/15 text-green">
        <CheckIcon className="size-6" strokeWidth={2.4} />
      </span>
      <div className="text-[15px] font-semibold text-foreground">Working tree clean</div>
      <div className="text-sm">Nothing to commit — every change is on a branch.</div>
    </div>
  )
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

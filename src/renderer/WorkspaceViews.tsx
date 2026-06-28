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
import { buildHeadCommitRows, buildUnifiedFileRows } from './lib/status-file-rows'
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
  const { status, stageFile, unstageFile } = useWorkingTreeStatus()
  const { commit, committing, amend, amending, loadHeadMessage } = useActionRunner()
  const { opening } = useRepoSession()
  const history = useCommitHistory()
  const loading = opening || committing || amending
  const { actions, prompt, confirm } = useWorkspaceContext()
  const [selected, setSelected] = useState<SelectedFile | null>(null)
  const [amendActive, setAmendActive] = useState(false)
  const [drops, setDrops] = useState<FileDrops>(() => new Map())
  const headCommit = useHeadCommit(amendActive)
  const headFiles = headCommit.data?.files ?? []
  const headParentCount = headCommit.data?.parentCount ?? 0
  // A merge commit (parentCount > 1) stays reword-only, so it contributes no droppable rows.
  const amendRows = useMemo(
    () => (amendActive && headParentCount <= 1 ? buildHeadCommitRows(headFiles, drops) : []),
    [amendActive, headParentCount, headFiles, drops]
  )
  const { droppedHeadPaths, droppedHeadHunks } = useMemo(() => assembleDrops(drops), [drops])

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

  const handleFileAction = (action: FileAction, file: string) => {
    switch (action) {
      case 'stage':
        void stageFile(file)
        return
      case 'unstage':
        void unstageFile(file)
        return
      case 'discard':
        confirm({
          title: `Discard changes to ${file}?`,
          message: 'Local edits to this file are lost. Untracked files are deleted.',
          confirmText: 'Discard',
          destructive: true,
          onConfirm: () => void actions.discardChanges([file], `Discarded ${file}`)
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

  const totalChanges = useMemo(() => {
    if (!status) {
      return 0
    }
    return (
      status.modified.length +
      status.staged.length +
      status.not_added.length +
      status.conflicted.length +
      status.deleted.length +
      status.created.length +
      status.renamed.length
    )
  }, [status])
  const stagedCount = (status?.staged.length ?? 0) + (status?.created.length ?? 0)
  // Amend rewrites HEAD, so it needs a commit to rewrite and a non-conflicted tree to fold in; a
  // detached HEAD still has a commit, so it stays available.
  const amendAvailable = (history.log?.total ?? 0) > 0
  const amendDisabled = (status?.conflicted.length ?? 0) > 0

  const fileEntries = useMemo<SelectedFile[]>(() => {
    if (!status) {
      return []
    }
    return buildUnifiedFileRows(status).map((row) => ({ file: row.file }))
  }, [status])

  const stagedFiles = useMemo<string[]>(() => {
    if (!status) {
      return []
    }
    return buildUnifiedFileRows(status)
      .filter((row) => !row.isConflicted && row.stageState !== 'unstaged')
      .map((row) => row.file)
  }, [status])

  useEffect(() => {
    const current = selected
    // A head-commit selection lives outside the working-tree file list — don't reset it to a worktree row.
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
      // Leaving amend (un-tick or a landed amend) discards the drop selection so the next session
      // starts with every file kept.
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

  const selectHeadFile = (file: string) => {
    setSelected({ file, source: 'head-commit', range: buildHeadCommitRange(headParentCount) })
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

  // The commit panel stays mounted on a clean tree whenever there's a HEAD to amend, so a pure reword
  // (nothing staged) is reachable without first dirtying the working tree.
  if (totalChanges === 0 && !amendAvailable) {
    return <CleanWorkingTree />
  }

  return (
    <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] overflow-hidden">
      {totalChanges > 0 || amendActive ? (
        <div
          className="grid min-h-0 overflow-hidden"
          style={{ gridTemplateColumns: `${filesWidth}px minmax(0, 1fr)` }}
        >
          <div className="relative flex min-h-0 min-w-0 flex-col border-r">
            <div className="min-h-0 flex-1 overflow-hidden">
              <StatusPanel
                selected={selected}
                onSelect={(file, source) =>
                  source === 'head-commit' ? selectHeadFile(file) : setSelected({ file })
                }
                onToggleDrop={toggleHeadFileDrop}
                amendRows={amendRows}
                onFileAction={handleFileAction}
                headerActions={
                  totalChanges > 0 ? (
                    <>
                      <StashControl
                        stagedFiles={stagedFiles}
                        hasChanges={totalChanges > 0}
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
            <span
              onMouseDown={(event) => onResizeStart(event.nativeEvent)}
              aria-hidden="true"
              className="group/files-resize absolute -right-1 top-0 z-30 flex h-full w-2 cursor-col-resize items-stretch justify-center"
            >
              <span className="w-px bg-transparent transition-colors group-hover/files-resize:bg-primary/60" />
            </span>
          </div>
          <DiffPanel selected={selected} amendDrop={amendDrop} />
        </div>
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

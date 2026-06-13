import { CheckIcon } from 'lucide-react'
import { toast } from 'sonner'
import { CommitPanel } from './components/CommitPanel'
import { DiffPanel } from './components/DiffPanel'
import { HistoryPanel } from './components/HistoryPanel'
import { type SelectedFile, StatusPanel } from './components/StatusPanel'
import { StashControl } from './components/StatusPanel/StashControl'
import type { WorkspaceView } from './components/shell/Topbar'
import { useDialogs } from './components/ui/prompt-dialog'
import { useGitActions } from './hooks/git/useGitActions'
import { useStashes } from './hooks/git/useStashes'
import { useDraggableWidth } from './hooks/useDraggableWidth'
import type { CommitAction, FileAction } from './lib/git-actions'
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  Dynamic,
  type JSX,
  Show
} from './lib/react-compat'
import type { RefKind } from './lib/ref-tree'
import { buildUnifiedFileRows } from './lib/status-file-rows'
import type { GitStore } from './stores/git'

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
  git: GitStore
  repoPath: string | null
  remoteBranches: string[]
  visibleBranchRefs: ReadonlySet<string>
  onToggleTimelineVisibility?: (refKind: RefKind, fullPath: string) => void
  onCommitAction?: (action: CommitAction, sha: string, message: string) => void
  tabActive: () => boolean
}

function LocalChangesView(props: WorkspaceViewProps) {
  const git = props.git
  const actions = useGitActions(git)
  const stashList = useStashes(git.state.repoPath)
  const { prompt, confirm, dialogs } = useDialogs()
  const [selected, setSelected] = createSignal<SelectedFile | null>(null)

  const promptStash = (title: string, run: (message?: string) => Promise<boolean>) => {
    prompt({
      title,
      label: 'Message (optional)',
      placeholder: 'Describe these changes',
      confirmText: 'Stash',
      allowEmpty: true,
      onConfirm: (message) => void run(message.trim() || undefined).then(stashList.refetch)
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
        void git.stageFile(file)
        return
      case 'unstage':
        void git.unstageFile(file)
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

  const status = () => git.state.status
  const totalChanges = createMemo(() => {
    const current = status()
    if (!current) {
      return 0
    }
    return (
      current.modified.length +
      current.staged.length +
      current.not_added.length +
      current.conflicted.length +
      current.deleted.length +
      current.created.length +
      current.renamed.length
    )
  })
  const stagedCount = () => (status()?.staged.length ?? 0) + (status()?.created.length ?? 0)

  const fileEntries = createMemo<SelectedFile[]>(() => {
    const current = status()
    if (!current) {
      return []
    }
    return buildUnifiedFileRows(current).map((row) => ({ file: row.file }))
  })

  const stagedFiles = createMemo<string[]>(() => {
    const current = status()
    if (!current) {
      return []
    }
    return buildUnifiedFileRows(current)
      .filter((row) => !row.isConflicted && row.stageState !== 'unstaged')
      .map((row) => row.file)
  })

  createEffect(() => {
    const entries = fileEntries()
    const current = selected()
    const stillExists = current && entries.some((entry) => entry.file === current.file)
    if (!stillExists) {
      setSelected(entries[0] ?? null)
    }
  })

  return (
    <Show
      when={totalChanges() > 0}
      fallback={
        <>
          <CleanWorkingTree />
          {dialogs()}
        </>
      }
    >
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] overflow-hidden">
        <div
          className="grid min-h-0 overflow-hidden"
          style={{ gridTemplateColumns: `${filesWidth()}px minmax(0, 1fr)` }}
        >
          <div className="relative min-h-0 min-w-0">
            <StatusPanel
              status={git.state.status}
              selected={selected()}
              onSelect={(file) => setSelected({ file })}
              onStage={git.stageFile}
              onUnstage={git.unstageFile}
              onStageAll={git.stageAll}
              onUnstageAll={git.unstageAll}
              onFileAction={handleFileAction}
              headerActions={
                <>
                  <StashControl
                    stagedFiles={stagedFiles()}
                    hasChanges={totalChanges() > 0}
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
              }
              loading={git.loading() || git.state.statusLoading}
            />
            <span
              onMouseDown={(event) => onResizeStart(event.nativeEvent)}
              aria-hidden="true"
              className="group/files-resize absolute -right-1 top-0 z-30 flex h-full w-2 cursor-col-resize items-stretch justify-center"
            >
              <span className="w-px bg-transparent transition-colors group-hover/files-resize:bg-primary/60" />
            </span>
          </div>
          <DiffPanel git={git} selected={selected()} />
        </div>
        <CommitPanel
          onCommit={git.commit}
          loading={git.loading()}
          branch={git.state.currentBranch || 'no-branch'}
          stagedCount={stagedCount()}
        />
      </div>
      {dialogs()}
    </Show>
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
  const git = props.git

  return (
    <Show when={props.tabActive()}>
      <div className="min-h-0 flex-1 overflow-hidden">
        <HistoryPanel
          log={git.state.log}
          loading={git.state.logLoading}
          loadingMore={git.state.logLoadingMore}
          hasMore={git.state.logHasMore}
          onLoadMore={() => void git.loadMoreHistory()}
          repoPath={props.repoPath}
          remotes={git.state.remotes}
          currentBranch={git.state.currentBranch}
          remoteBranches={props.remoteBranches}
          visibleBranchRefs={props.visibleBranchRefs}
          onToggleTimelineVisibility={props.onToggleTimelineVisibility}
          onCommitAction={props.onCommitAction}
        />
      </div>
    </Show>
  )
}

const workspaceViewComponents = {
  history: HistoryView,
  'local-changes': LocalChangesView
} satisfies Record<WorkspaceView, Component<WorkspaceViewProps>>

interface WorkspaceViewRendererProps extends WorkspaceViewProps {
  activeView: WorkspaceView
}

export function WorkspaceViewRenderer(props: WorkspaceViewRendererProps): JSX.Element {
  const View = workspaceViewComponents[props.activeView]
  return <Dynamic component={View} {...props} />
}

import { CheckIcon } from 'lucide-react'
import { CommitPanel } from './components/CommitPanel'
import { DiffPanel } from './components/DiffPanel'
import { HistoryPanel } from './components/HistoryPanel'
import { type SelectedFile, StatusPanel } from './components/StatusPanel'
import type { WorkspaceView } from './components/shell/Topbar'
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
import type { GitStore } from './stores/git'

interface WorkspaceViewProps {
  git: GitStore
  repoPath: string | null
  remoteBranches: string[]
  visibleBranchRefs: ReadonlySet<string>
  onToggleTimelineVisibility?: (refKind: RefKind, fullPath: string) => void
  tabActive: () => boolean
}

function LocalChangesView(props: WorkspaceViewProps) {
  const git = props.git
  const [selected, setSelected] = createSignal<SelectedFile | null>(null)

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
    return [
      ...current.conflicted.map((file) => ({ file, staged: false })),
      ...current.staged.map((file) => ({ file, staged: true })),
      ...current.created.map((file) => ({ file, staged: true })),
      ...current.modified.map((file) => ({ file, staged: false })),
      ...current.deleted.map((file) => ({ file, staged: false })),
      ...current.renamed.map((entry) => ({ file: entry.to, staged: false })),
      ...current.not_added.map((file) => ({ file, staged: false }))
    ]
  })

  createEffect(() => {
    const entries = fileEntries()
    const current = selected()
    const stillExists =
      current &&
      entries.some((entry) => entry.file === current.file && entry.staged === current.staged)
    if (!stillExists) {
      setSelected(entries[0] ?? null)
    }
  })

  return (
    <Show when={totalChanges() > 0} fallback={<CleanWorkingTree />}>
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] overflow-hidden">
        <div className="grid min-h-0 grid-cols-[minmax(280px,340px)_minmax(0,1fr)] overflow-hidden">
          <StatusPanel
            status={git.state.status}
            selected={selected()}
            onSelect={(file, staged) => setSelected({ file, staged })}
            onStage={git.stageFile}
            onUnstage={git.unstageFile}
            loading={git.loading() || git.state.statusLoading}
          />
          <DiffPanel git={git} selected={selected()} />
        </div>
        <CommitPanel
          onCommit={git.commit}
          loading={git.loading()}
          branch={git.state.currentBranch || 'no-branch'}
          stagedCount={stagedCount()}
        />
      </div>
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

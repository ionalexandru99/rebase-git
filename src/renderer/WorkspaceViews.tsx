import { CommitPanel } from './components/CommitPanel'
import { HistoryPanel } from './components/HistoryPanel'
import { StatusPanel } from './components/StatusPanel'
import type { SidebarView } from './components/shell/Sidebar'
import { type Component, Dynamic, type JSX, Show } from './lib/react-compat'
import type { GitStore } from './stores/git'

interface WorkspaceViewProps {
  git: GitStore
  repoPath: string | null
  remoteBranches: string[]
  visibleBranchRefs: ReadonlySet<string>
  tabActive: () => boolean
}

function LocalChangesView(props: WorkspaceViewProps) {
  const git = props.git

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-2.5 overflow-hidden xl:grid-cols-[minmax(21rem,0.85fr)_minmax(0,1.15fr)]">
      <div className="min-h-0 overflow-hidden">
        <StatusPanel
          status={git.state.status}
          onStage={git.stageFile}
          onUnstage={git.unstageFile}
          loading={git.loading() || git.state.statusLoading}
        />
      </div>
      <div className="min-h-0 overflow-hidden">
        <CommitPanel onCommit={git.commit} loading={git.loading()} />
      </div>
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
        />
      </div>
    </Show>
  )
}

const workspaceViewComponents = {
  history: HistoryView,
  'local-changes': LocalChangesView
} satisfies Record<SidebarView, Component<WorkspaceViewProps>>

interface WorkspaceViewRendererProps extends WorkspaceViewProps {
  activeView: SidebarView
}

export function WorkspaceViewRenderer(props: WorkspaceViewRendererProps): JSX.Element {
  const View = workspaceViewComponents[props.activeView]
  return <Dynamic component={View} {...props} />
}

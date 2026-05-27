import { AlertCircleIcon } from 'lucide-react'
import { createEffect, createMemo, type JSX, onMount, Show } from '@/lib/react-compat'
import { Alert, AlertDescription } from './components/ui/alert'
import { RepoPicker } from './RepoPicker'
import { useGitStore } from './stores/git'
import { Workspace } from './Workspace'

interface TabViewProps {
  tabId: string
  tabActive: () => boolean
  initialRepoPath?: string | null
  recentRepos: string[]
  discoveredRepos: string[]
  workspaces: string[]
  activeWorkspace: string | null
  onSwitchWorkspace: (path: string) => Promise<void>
  onAddWorkspace: () => Promise<unknown>
  onRemoveWorkspace: (path: string) => Promise<void>
  onReportRepo: (id: string, path: string | null) => void
  onRequestOpenRepo: (sourceTabId: string, path: string) => boolean
}

export function TabView(props: TabViewProps) {
  const git = useGitStore(props.tabId, props.tabActive)

  const modifiedCount = () => git.state.status?.modified.length ?? 0
  const stagedCount = () => git.state.status?.staged.length ?? 0
  const untrackedCount = () => git.state.status?.not_added.length ?? 0
  const totalChanges = createMemo(() => modifiedCount() + stagedCount() + untrackedCount())

  onMount(() => {
    if (props.initialRepoPath) {
      git.openRepo(props.initialRepoPath)
    }
  })

  createEffect(() => {
    props.onReportRepo(props.tabId, git.state.repoPath ?? null)
  })

  const errorBanner = (): JSX.Element => (
    <Show when={git.state.error}>
      <div className="shrink-0 border-b px-4 py-2">
        <Alert variant="destructive" className="border-destructive/30">
          <AlertCircleIcon />
          <AlertDescription>{git.state.error}</AlertDescription>
        </Alert>
      </div>
    </Show>
  )

  return (
    <Show
      when={git.state.repoPath}
      fallback={
        <>
          {errorBanner()}
          <RepoPicker
            recentRepos={props.recentRepos}
            discoveredRepos={props.discoveredRepos}
            workspaces={props.workspaces}
            activeWorkspace={props.activeWorkspace}
            onSwitchWorkspace={props.onSwitchWorkspace}
            onAddWorkspace={props.onAddWorkspace}
            onRemoveWorkspace={props.onRemoveWorkspace}
            onOpenRepo={(path) => {
              if (!props.onRequestOpenRepo(props.tabId, path)) {
                git.openRepo(path)
              }
            }}
          />
        </>
      }
    >
      <Workspace
        git={git}
        tabActive={props.tabActive}
        modifiedCount={modifiedCount()}
        stagedCount={stagedCount()}
        untrackedCount={untrackedCount()}
        totalChanges={totalChanges()}
        errorBanner={errorBanner()}
      />
    </Show>
  )
}

import { AlertCircleIcon } from 'lucide-react'
import { createEffect, createSignal, type JSX, Show } from '@/lib/react-compat'
import { Alert, AlertDescription } from './components/ui/alert'
import { NewTab, type WorkspaceCatalog } from './NewTab'
import { useGitStore } from './stores/git'
import { Workspace } from './Workspace'

interface RepoTabProps {
  tabId: string
  tabActive: () => boolean
  repoPath: string
  catalog: WorkspaceCatalog
  onOpenRepo: (path: string) => void
  onRepoOpened: (path: string) => void
}

export function RepoTab(props: RepoTabProps) {
  const git = useGitStore(props.tabId, props.tabActive)
  const [lastRepoPathRequested, setLastRepoPathRequested] = createSignal<string | null>(null)

  createEffect(() => {
    if (props.repoPath !== lastRepoPathRequested()) {
      setLastRepoPathRequested(props.repoPath)
      void git.openRepo(props.repoPath)
    }
  })

  createEffect(() => {
    if (git.state.repoPath === props.repoPath) {
      props.onRepoOpened(git.state.repoPath)
    }
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
          <Show when={git.state.opening}>
            <OpeningRepoState />
          </Show>
          <Show when={!git.state.opening && git.state.error}>
            <NewTab catalog={props.catalog} onOpenRepo={props.onOpenRepo} />
          </Show>
        </>
      }
    >
      <Workspace git={git} tabActive={props.tabActive} errorBanner={errorBanner()} />
    </Show>
  )
}

function OpeningRepoState() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
      Opening repository...
    </div>
  )
}

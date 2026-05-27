import { AlertCircleIcon } from 'lucide-react'
import { type JSX, onMount, Show } from '@/lib/react-compat'
import { Alert, AlertDescription } from './components/ui/alert'
import { useGitStore } from './stores/git'
import { Workspace } from './Workspace'

interface RepoTabProps {
  tabId: string
  tabActive: () => boolean
  repoPath: string
}

export function RepoTab(props: RepoTabProps) {
  const git = useGitStore(props.tabId, props.tabActive)

  onMount(() => {
    git.openRepo(props.repoPath)
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
            <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
              Opening repository...
            </div>
          </Show>
        </>
      }
    >
      <Workspace git={git} tabActive={props.tabActive} errorBanner={errorBanner()} />
    </Show>
  )
}

import { AlertCircleIcon, FolderOpenIcon, Loader2Icon } from 'lucide-react'
import { Show } from '@/lib/react-compat'
import { Alert, AlertDescription } from '../ui/alert'
import { Button } from '../ui/button'
import { DiscoveredReposList } from './DiscoveredReposList'
import { OnboardingHero } from './OnboardingHero'
import { WorkspacePicker } from './WorkspacePicker'

interface OnboardingScreenProps {
  workingDirectory: string | null
  discoveredRepos: string[]
  loading: boolean
  error: string | null
  onSelectDirectory: () => Promise<string | null>
  onComplete: () => void
  onOpenRepo: (path: string) => void
}

export function OnboardingScreen(props: OnboardingScreenProps) {
  return (
    <div className="flex h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-md">
        <OnboardingHero />

        <div className="rounded-md border border-border bg-card">
          <Show
            when={props.workingDirectory}
            fallback={
              <WorkspacePicker
                loading={props.loading}
                onSelectDirectory={props.onSelectDirectory}
              />
            }
          >
            {(workingDirectory) => (
              <SelectedWorkspaceBody
                workingDirectory={workingDirectory()}
                discoveredRepos={props.discoveredRepos}
                loading={props.loading}
                error={props.error}
                onSelectDirectory={props.onSelectDirectory}
                onComplete={props.onComplete}
                onOpenRepo={props.onOpenRepo}
              />
            )}
          </Show>
        </div>
      </div>
    </div>
  )
}

interface SelectedWorkspaceBodyProps {
  workingDirectory: string
  discoveredRepos: string[]
  loading: boolean
  error: string | null
  onSelectDirectory: () => Promise<string | null>
  onComplete: () => void
  onOpenRepo: (path: string) => void
}

function SelectedWorkspaceBody(props: SelectedWorkspaceBodyProps) {
  return (
    <div className="p-3.5">
      <SelectedWorkspacePath path={props.workingDirectory} />
      <SelectedWorkspaceError error={props.error} />
      <SelectedWorkspaceRepos
        repos={props.discoveredRepos}
        loading={props.loading}
        error={props.error}
        onOpenRepo={props.onOpenRepo}
      />
      <SelectedWorkspaceActions
        loading={props.loading}
        onSelectDirectory={props.onSelectDirectory}
        onComplete={props.onComplete}
      />
    </div>
  )
}

function SelectedWorkspacePath(props: { path: string }) {
  return (
    <div className="mb-3 flex h-8 items-center gap-2 rounded-sm border border-border bg-background px-2.5">
      <FolderOpenIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate text-xs text-foreground/85">{props.path}</span>
    </div>
  )
}

function SelectedWorkspaceError(props: { error: string | null }) {
  return (
    <Show when={props.error}>
      <Alert variant="destructive" className="mb-3 border-destructive/30 bg-destructive/10 py-2">
        <AlertCircleIcon className="h-3.5 w-3.5" />
        <AlertDescription className="text-sm">{props.error}</AlertDescription>
      </Alert>
    </Show>
  )
}

function SelectedWorkspaceRepos(props: {
  repos: string[]
  loading: boolean
  error: string | null
  onOpenRepo: (path: string) => void
}) {
  return (
    <Show
      when={props.repos.length > 0}
      fallback={
        <Show when={!props.loading && !props.error}>
          <div className="mb-3 rounded-sm border border-dashed border-border px-4 py-6 text-center">
            <p className="text-sm text-muted-foreground">
              No git repositories found in this folder.
            </p>
          </div>
        </Show>
      }
    >
      <DiscoveredReposList repos={props.repos} onOpenRepo={props.onOpenRepo} />
    </Show>
  )
}

function SelectedWorkspaceActions(props: {
  loading: boolean
  onSelectDirectory: () => Promise<string | null>
  onComplete: () => void
}) {
  return (
    <div className="flex gap-2">
      <Button
        variant="outline"
        onClick={() => props.onSelectDirectory()}
        disabled={props.loading}
        className="flex-1"
      >
        <Show when={props.loading} fallback={'Change Folder'}>
          <Loader2Icon className="animate-spin" />
        </Show>
      </Button>
      <Button onClick={() => props.onComplete()} className="flex-1">
        Get Started
      </Button>
    </div>
  )
}

import { AlertCircle, FolderOpen, Loader2 } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
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

export function OnboardingScreen({
  workingDirectory,
  discoveredRepos,
  loading,
  error,
  onSelectDirectory,
  onComplete,
  onOpenRepo
}: OnboardingScreenProps) {
  return (
    <div className="flex h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-md">
        <OnboardingHero />

        <div className="rounded-md border border-border bg-card">
          {!workingDirectory ? (
            <WorkspacePicker loading={loading} onSelectDirectory={onSelectDirectory} />
          ) : (
            <SelectedWorkspaceBody
              workingDirectory={workingDirectory}
              discoveredRepos={discoveredRepos}
              loading={loading}
              error={error}
              onSelectDirectory={onSelectDirectory}
              onComplete={onComplete}
              onOpenRepo={onOpenRepo}
            />
          )}
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

function SelectedWorkspaceBody({
  workingDirectory,
  discoveredRepos,
  loading,
  error,
  onSelectDirectory,
  onComplete,
  onOpenRepo
}: SelectedWorkspaceBodyProps) {
  const repoCount = discoveredRepos.length

  return (
    <div className="p-3.5">
      <div className="mb-3 flex h-8 items-center gap-2 rounded-sm border border-border bg-background px-2.5">
        <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-xs text-foreground/85">{workingDirectory}</span>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-3 border-destructive/30 bg-destructive/10 py-2">
          <AlertCircle className="h-3.5 w-3.5" />
          <AlertDescription className="text-sm">{error}</AlertDescription>
        </Alert>
      )}

      {repoCount > 0 ? (
        <DiscoveredReposList repos={discoveredRepos} onOpenRepo={onOpenRepo} />
      ) : !loading && !error ? (
        <div className="mb-3 rounded-sm border border-dashed border-border px-4 py-6 text-center">
          <p className="text-sm text-muted-foreground">No git repositories found in this folder.</p>
        </div>
      ) : null}

      <div className="flex gap-2">
        <Button variant="outline" onClick={onSelectDirectory} disabled={loading} className="flex-1">
          {loading ? <Loader2 className="animate-spin" /> : 'Change Folder'}
        </Button>
        <Button onClick={onComplete} className="flex-1">
          Get Started
        </Button>
      </div>
    </div>
  )
}

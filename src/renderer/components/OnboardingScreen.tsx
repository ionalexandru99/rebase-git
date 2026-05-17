import { AlertCircle, FolderOpen, GitBranch, Loader2 } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'

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
  const repoCount = discoveredRepos.length

  return (
    <div className="flex h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3.5 flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 ring-1 ring-inset ring-primary/30">
            <GitBranch className="h-4 w-4 text-primary" strokeWidth={2} />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Welcome to Rebase
          </h1>
          <p className="mx-auto mt-1.5 max-w-xs text-sm leading-relaxed text-muted-foreground">
            Set up your workspace by choosing the folder where you keep your Git repositories.
          </p>
        </div>

        <div className="rounded-md border border-border bg-card">
          {!workingDirectory ? (
            <div className="p-3.5">
              <div className="mb-3 flex flex-col items-center justify-center rounded-sm border border-dashed border-border px-4 py-7 text-center">
                <FolderOpen className="mb-2 h-5 w-5 text-muted-foreground/50" strokeWidth={1.5} />
                <p className="text-sm text-muted-foreground">No workspace folder selected</p>
              </div>
              <Button onClick={onSelectDirectory} disabled={loading} className="w-full">
                {loading ? <Loader2 className="animate-spin" /> : <FolderOpen />}
                Select Working Folder
              </Button>
            </div>
          ) : (
            <div className="p-3.5">
              <div className="mb-3 flex h-8 items-center gap-2 rounded-sm border border-border bg-background px-2.5">
                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate text-xs text-foreground/85">{workingDirectory}</span>
              </div>

              {error && (
                <Alert
                  variant="destructive"
                  className="mb-3 border-destructive/30 bg-destructive/10 py-2"
                >
                  <AlertCircle className="h-3.5 w-3.5" />
                  <AlertDescription className="text-sm">{error}</AlertDescription>
                </Alert>
              )}

              {repoCount > 0 ? (
                <div className="mb-3">
                  <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    Found {repoCount} {repoCount === 1 ? 'repository' : 'repositories'}
                  </h2>
                  <div className="overflow-hidden rounded-sm border border-border">
                    <ScrollArea className="h-44">
                      <ul className="divide-y divide-border/60">
                        {discoveredRepos.map((repo) => (
                          <li key={repo}>
                            <button
                              type="button"
                              className="flex h-7 w-full items-center gap-2 border-none bg-transparent px-2.5 text-left text-sm text-foreground/85 transition-colors duration-75 hover:bg-accent hover:text-foreground"
                              onClick={() => onOpenRepo(repo)}
                            >
                              <GitBranch
                                className="h-3 w-3 shrink-0 text-muted-foreground"
                                strokeWidth={2}
                              />
                              <span className="truncate">{repo}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </ScrollArea>
                  </div>
                </div>
              ) : !loading && !error ? (
                <div className="mb-3 rounded-sm border border-dashed border-border px-4 py-6 text-center">
                  <p className="text-sm text-muted-foreground">
                    No git repositories found in this folder.
                  </p>
                </div>
              ) : null}

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={onSelectDirectory}
                  disabled={loading}
                  className="flex-1"
                >
                  {loading ? <Loader2 className="animate-spin" /> : 'Change Folder'}
                </Button>
                <Button onClick={onComplete} className="flex-1">
                  Get Started
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

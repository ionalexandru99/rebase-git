import { useCallback, useEffect, useState } from 'react'
import { Clock, FolderOpen, GitBranch } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { CommitPanel } from '@/components/CommitPanel'
import { Header } from '@/components/Header'
import { HistoryPanel } from '@/components/HistoryPanel'
import { OnboardingScreen } from '@/components/OnboardingScreen'
import { StatusPanel } from '@/components/StatusPanel'
import { useGit } from '@/hooks/useGit'
import { useOnboarding } from '@/hooks/useOnboarding'

function App() {
  const git = useGit()
  const onboarding = useOnboarding()
  const [recentRepos, setRecentRepos] = useState<string[]>([])
  const modifiedCount = git.status?.modified.length ?? 0
  const stagedCount = git.status?.staged.length ?? 0
  const untrackedCount = git.status?.not_added.length ?? 0
  const totalChanges = modifiedCount + stagedCount + untrackedCount

  useEffect(() => {
    window.electronAPI.getRecentRepos().then(setRecentRepos)
  }, [])

  const handleOpenRepo = useCallback(async () => {
    const path = await window.electronAPI.selectFolder()
    if (path) await git.openRepo(path)
  }, [git])

  const handleOpenRepoFromOnboarding = useCallback(
    async (path: string) => {
      await onboarding.completeOnboarding()
      await git.openRepo(path)
    },
    [git, onboarding]
  )

  if (onboarding.onboardingComplete === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground">
        <div className="animate-pulse text-[12px] text-muted-foreground">Loading...</div>
      </div>
    )
  }

  if (!onboarding.onboardingComplete) {
    return (
      <TooltipProvider>
        <OnboardingScreen
          workingDirectory={onboarding.workingDirectory}
          discoveredRepos={onboarding.discoveredRepos}
          loading={onboarding.loading}
          error={onboarding.error}
          onSelectDirectory={onboarding.selectWorkingDirectory}
          onComplete={onboarding.completeOnboarding}
          onOpenRepo={handleOpenRepoFromOnboarding}
        />
        <Toaster />
      </TooltipProvider>
    )
  }

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col bg-background text-foreground">
        <Header
          currentBranch={git.currentBranch}
          repoPath={git.repoPath}
          onOpenRepo={handleOpenRepo}
        />

        {git.error && (
          <div className="shrink-0 border-b border-destructive/30 bg-destructive/10 px-4 py-1.5 text-[11.5px] text-destructive">
            {git.error}
          </div>
        )}

        {!git.repoPath ? (
          <EmptyState
            recentRepos={recentRepos}
            discoveredRepos={onboarding.discoveredRepos}
            onOpenRepo={(path) => git.openRepo(path)}
            onPickRepo={handleOpenRepo}
          />
        ) : (
          <Workspace
            git={git}
            modifiedCount={modifiedCount}
            stagedCount={stagedCount}
            untrackedCount={untrackedCount}
            totalChanges={totalChanges}
          />
        )}
      </div>
      <Toaster />
    </TooltipProvider>
  )
}

interface EmptyStateProps {
  recentRepos: string[]
  discoveredRepos: string[]
  onOpenRepo: (path: string) => void
  onPickRepo: () => void
}

function EmptyState({ recentRepos, discoveredRepos, onOpenRepo, onPickRepo }: EmptyStateProps) {
  return (
    <div className="flex flex-1 items-center justify-center overflow-hidden p-6">
      <div className="w-full max-w-md">
        <div className="mb-5 text-center">
          <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 ring-1 ring-inset ring-primary/30">
            <FolderOpen className="h-4 w-4 text-primary" strokeWidth={2} />
          </div>
          <h2 className="text-[16px] font-semibold tracking-tight text-foreground">
            Open a Repository
          </h2>
          <p className="mx-auto mt-1.5 max-w-xs text-[12px] leading-relaxed text-muted-foreground">
            Choose a Git repository to start tracking changes, viewing history, and making commits.
          </p>
        </div>

        <Button
          onClick={onPickRepo}
          className="mb-5 h-8 w-full gap-1.5 rounded-[5px] bg-primary text-[12px] font-medium text-primary-foreground hover:bg-primary/90"
        >
          <FolderOpen className="h-3.5 w-3.5" />
          Open Repository
        </Button>

        {discoveredRepos.length > 0 && (
          <RepoList
            icon={<GitBranch className="h-3 w-3 text-muted-foreground" strokeWidth={2} />}
            title="Repositories in workspace"
            repos={discoveredRepos}
            onSelect={onOpenRepo}
          />
        )}
        {recentRepos.length > 0 && (
          <RepoList
            icon={<Clock className="h-3 w-3 text-muted-foreground" strokeWidth={2} />}
            title="Recent"
            repos={recentRepos}
            onSelect={onOpenRepo}
          />
        )}
      </div>
    </div>
  )
}

interface RepoListProps {
  icon: React.ReactNode
  title: string
  repos: string[]
  onSelect: (path: string) => void
}

function RepoList({ icon, title, repos, onSelect }: RepoListProps) {
  return (
    <div className="mb-4 last:mb-0">
      <h3 className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        {title}
      </h3>
      <div className="overflow-hidden rounded-sm border border-border bg-card">
        <ScrollArea className="max-h-40">
          <ul className="divide-y divide-border/60">
            {repos.map((repo) => (
              <li key={repo}>
                <button
                  type="button"
                  className="flex h-7 w-full items-center gap-2 border-none bg-transparent px-2.5 text-left text-[11px] text-foreground/85 transition-colors hover:bg-accent/60 hover:text-foreground"
                  onClick={() => onSelect(repo)}
                >
                  {icon}
                  <span className="truncate font-mono">{repo}</span>
                </button>
              </li>
            ))}
          </ul>
        </ScrollArea>
      </div>
    </div>
  )
}

interface WorkspaceProps {
  git: ReturnType<typeof useGit>
  modifiedCount: number
  stagedCount: number
  untrackedCount: number
  totalChanges: number
}

function Workspace({
  git,
  modifiedCount,
  stagedCount,
  untrackedCount,
  totalChanges
}: WorkspaceProps) {
  const repoName = git.repoPath?.split('/').filter(Boolean).at(-1) ?? 'Repository'

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Slim repo summary strip — no colored cards, no chrome. */}
      <div className="flex h-9 shrink-0 items-center justify-between gap-4 border-b border-border bg-card/30 px-3.5">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <h2
            className="truncate text-[13px] font-semibold tracking-tight text-foreground"
            title={git.repoPath ?? undefined}
          >
            {repoName}
          </h2>
          <span aria-hidden className="text-muted-foreground/40">
            ·
          </span>
          {totalChanges === 0 ? (
            <span className="text-[11.5px] font-medium text-primary">Clean</span>
          ) : (
            <span className="flex items-baseline gap-2 text-[11.5px]">
              <span className="text-foreground/90">
                {totalChanges} change{totalChanges === 1 ? '' : 's'}
              </span>
              <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground/70">
                {modifiedCount}M
                <span className="mx-1 text-muted-foreground/30">·</span>
                {stagedCount}A
                <span className="mx-1 text-muted-foreground/30">·</span>
                {untrackedCount}?
              </span>
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
          <GitBranch className="h-3 w-3 text-primary" strokeWidth={2} />
          <span className="text-foreground/85">{git.currentBranch || '-'}</span>
        </div>
      </div>

      {/* Two-pane workspace — tight gaps, restrained chrome. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2.5 overflow-hidden p-2.5 xl:grid-cols-[minmax(340px,0.85fr)_minmax(0,1.15fr)]">
        <div className="min-h-0 overflow-hidden">
          <StatusPanel
            status={git.status}
            onStage={git.stageFile}
            onUnstage={git.unstageFile}
            loading={git.loading}
          />
        </div>
        <div className="flex min-h-0 flex-col gap-2.5 overflow-hidden">
          <CommitPanel onCommit={git.commit} loading={git.loading} />
          <div className="min-h-0 flex-1 overflow-hidden">
            <HistoryPanel log={git.log} loading={git.loading} />
          </div>
        </div>
      </div>
    </div>
  )
}

export default App

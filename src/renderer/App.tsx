import { useCallback, useEffect, useMemo, useState } from 'react'
import { Clock, FolderOpen, GitBranch, Repeat } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { CommitPanel } from '@/components/CommitPanel'
import { HistoryPanel } from '@/components/HistoryPanel'
import { OnboardingScreen } from '@/components/OnboardingScreen'
import { StatusPanel } from '@/components/StatusPanel'
import { TabBar, type TabDescriptor } from '@/components/TabBar'
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher'
import { useGit } from '@/hooks/useGit'
import { useOnboarding } from '@/hooks/useOnboarding'

interface TabRecord {
  id: string
}

let tabSeq = 0
const nextTabId = () => `tab-${++tabSeq}-${Date.now()}`

function App() {
  const onboarding = useOnboarding()
  const [tabs, setTabs] = useState<TabRecord[]>(() => [{ id: nextTabId() }])
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0]?.id ?? '')
  const [tabTitles, setTabTitles] = useState<Record<string, { title: string; hasRepo: boolean }>>(
    {}
  )
  const [recentRepos, setRecentRepos] = useState<string[]>([])

  useEffect(() => {
    window.electronAPI.getRecentRepos().then(setRecentRepos)
  }, [])

  const reportTabState = useCallback(
    (id: string, title: string, hasRepo: boolean) => {
      setTabTitles((prev) => {
        const existing = prev[id]
        if (existing && existing.title === title && existing.hasRepo === hasRepo) return prev
        return { ...prev, [id]: { title, hasRepo } }
      })
    },
    []
  )

  const newTab = useCallback(() => {
    const id = nextTabId()
    setTabs((prev) => [...prev, { id }])
    setActiveTabId(id)
  }, [])

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => {
      if (prev.length <= 1) return prev
      const idx = prev.findIndex((t) => t.id === id)
      const next = prev.filter((t) => t.id !== id)
      setActiveTabId((current) => {
        if (current !== id) return current
        return next[Math.min(idx, next.length - 1)].id
      })
      return next
    })
    setTabTitles((prev) => {
      if (!(id in prev)) return prev
      const { [id]: _removed, ...rest } = prev
      return rest
    })
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      if (e.key === 't') {
        e.preventDefault()
        newTab()
      } else if (e.key === 'w') {
        e.preventDefault()
        closeTab(activeTabId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeTabId, closeTab, newTab])

  const tabDescriptors = useMemo<TabDescriptor[]>(
    () =>
      tabs.map((t) => {
        const meta = tabTitles[t.id]
        return {
          id: t.id,
          title: meta?.title ?? 'New tab',
          hasRepo: meta?.hasRepo ?? false
        }
      }),
    [tabs, tabTitles]
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
          onOpenRepo={async (path) => {
            await onboarding.completeOnboarding()
            // The initial tab will pick this up via its empty state.
            window.electronAPI.openRepo(path)
          }}
        />
        <Toaster />
      </TooltipProvider>
    )
  }

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col bg-background text-foreground">
        <TabBar
          tabs={tabDescriptors}
          activeTabId={activeTabId}
          onSelect={setActiveTabId}
          onClose={closeTab}
          onNew={newTab}
        />

        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={
                tab.id === activeTabId
                  ? 'flex min-h-0 flex-1 flex-col'
                  : 'pointer-events-none invisible absolute inset-0 flex min-h-0 flex-col'
              }
              aria-hidden={tab.id !== activeTabId}
            >
              <TabView
                tabId={tab.id}
                recentRepos={recentRepos}
                discoveredRepos={onboarding.discoveredRepos}
                workspaces={onboarding.workspaces}
                activeWorkspace={onboarding.activeWorkspace}
                onSwitchWorkspace={onboarding.switchWorkspace}
                onAddWorkspace={onboarding.addWorkspace}
                onRemoveWorkspace={onboarding.removeWorkspace}
                onReportState={reportTabState}
              />
            </div>
          ))}
        </div>
      </div>
      <Toaster />
    </TooltipProvider>
  )
}

interface TabViewProps {
  tabId: string
  recentRepos: string[]
  discoveredRepos: string[]
  workspaces: string[]
  activeWorkspace: string | null
  onSwitchWorkspace: (path: string) => Promise<void>
  onAddWorkspace: () => Promise<unknown>
  onRemoveWorkspace: (path: string) => Promise<void>
  onReportState: (id: string, title: string, hasRepo: boolean) => void
}

function TabView({
  tabId,
  recentRepos,
  discoveredRepos,
  workspaces,
  activeWorkspace,
  onSwitchWorkspace,
  onAddWorkspace,
  onRemoveWorkspace,
  onReportState
}: TabViewProps) {
  const git = useGit()
  const modifiedCount = git.status?.modified.length ?? 0
  const stagedCount = git.status?.staged.length ?? 0
  const untrackedCount = git.status?.not_added.length ?? 0
  const totalChanges = modifiedCount + stagedCount + untrackedCount

  // Surface the repo title back to App so the TabBar label stays in sync.
  useEffect(() => {
    const name = git.repoPath?.split('/').filter(Boolean).at(-1) ?? null
    onReportState(tabId, name ?? 'New tab', Boolean(name))
  }, [git.repoPath, tabId, onReportState])

  const handleOpenRepo = useCallback(async () => {
    const path = await window.electronAPI.selectFolder()
    if (path) await git.openRepo(path)
  }, [git])

  const handleSwitchRepo = useCallback(async () => {
    const path = await window.electronAPI.selectFolder()
    if (!path) return
    await git.closeRepo()
    await git.openRepo(path)
  }, [git])

  return (
    <>
      {git.error && (
        <div className="shrink-0 border-b border-destructive/30 bg-destructive/10 px-4 py-1.5 text-[11.5px] text-destructive">
          {git.error}
        </div>
      )}

      {!git.repoPath ? (
        <EmptyState
          recentRepos={recentRepos}
          discoveredRepos={discoveredRepos}
          workspaces={workspaces}
          activeWorkspace={activeWorkspace}
          onSwitchWorkspace={onSwitchWorkspace}
          onAddWorkspace={onAddWorkspace}
          onRemoveWorkspace={onRemoveWorkspace}
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
          onSwitchRepo={handleSwitchRepo}
        />
      )}
    </>
  )
}

interface EmptyStateProps {
  recentRepos: string[]
  discoveredRepos: string[]
  workspaces: string[]
  activeWorkspace: string | null
  onSwitchWorkspace: (path: string) => Promise<void>
  onAddWorkspace: () => Promise<unknown>
  onRemoveWorkspace: (path: string) => Promise<void>
  onOpenRepo: (path: string) => void
  onPickRepo: () => void
}

function EmptyState({
  recentRepos,
  discoveredRepos,
  workspaces,
  activeWorkspace,
  onSwitchWorkspace,
  onAddWorkspace,
  onRemoveWorkspace,
  onOpenRepo,
  onPickRepo
}: EmptyStateProps) {
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

        {(workspaces.length > 0 || activeWorkspace) && (
          <div className="mb-4">
            <h3 className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Workspace
            </h3>
            <WorkspaceSwitcher
              workspaces={workspaces}
              activeWorkspace={activeWorkspace}
              onSwitch={onSwitchWorkspace}
              onAdd={onAddWorkspace}
              onRemove={onRemoveWorkspace}
            />
          </div>
        )}

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
  onSwitchRepo: () => void
}

function Workspace({
  git,
  modifiedCount,
  stagedCount,
  untrackedCount,
  totalChanges,
  onSwitchRepo
}: WorkspaceProps) {
  const repoName = git.repoPath?.split('/').filter(Boolean).at(-1) ?? 'Repository'

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Per-tab toolbar — repo context + branch + switch action. */}
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
          <span
            aria-hidden
            className="hidden truncate font-mono text-[10.5px] text-muted-foreground/60 sm:inline"
            title={git.repoPath ?? undefined}
          >
            {git.repoPath}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
            <GitBranch className="h-3 w-3 text-primary" strokeWidth={2} />
            <span className="text-foreground/85">{git.currentBranch || 'no-branch'}</span>
          </div>
          <Button
            onClick={onSwitchRepo}
            variant="ghost"
            size="sm"
            className="h-6 gap-1 rounded-[5px] px-2 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Repeat className="h-3 w-3" strokeWidth={2} />
            Switch Repo
          </Button>
        </div>
      </div>

      {/* Two-pane workspace */}
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

import { AlertCircle, Folder, FolderPlus, GitBranch, Search } from 'lucide-react'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useState
} from 'react'
import { CommitPanel } from '@/components/CommitPanel'
import { HistoryPanel } from '@/components/HistoryPanel'
import { OnboardingScreen } from '@/components/OnboardingScreen'
import { StatusPanel } from '@/components/StatusPanel'
import { Shell } from '@/components/shell/Shell'
import type { SidebarView } from '@/components/shell/Sidebar'
import { TabBar, type TabDescriptor } from '@/components/TabBar'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Toaster } from '@/components/ui/sonner'
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

  const reportTabState = useCallback((id: string, title: string, hasRepo: boolean) => {
    setTabTitles((prev) => {
      const existing = prev[id]
      if (existing && existing.title === title && existing.hasRepo === hasRepo) return prev
      return { ...prev, [id]: { title, hasRepo } }
    })
  }, [])

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
        <div className="animate-pulse text-xs text-muted-foreground">Loading...</div>
      </div>
    )
  }

  if (!onboarding.onboardingComplete) {
    return (
      <>
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
      </>
    )
  }

  return (
    <>
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
    </>
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

  return (
    <>
      {git.error && (
        <div className="shrink-0 border-b px-4 py-2">
          <Alert variant="destructive" className="border-destructive/30">
            <AlertCircle />
            <AlertDescription>{git.error}</AlertDescription>
          </Alert>
        </div>
      )}

      {!git.repoPath ? (
        <RepoPicker
          recentRepos={recentRepos}
          discoveredRepos={discoveredRepos}
          workspaces={workspaces}
          activeWorkspace={activeWorkspace}
          onSwitchWorkspace={onSwitchWorkspace}
          onAddWorkspace={onAddWorkspace}
          onRemoveWorkspace={onRemoveWorkspace}
          onOpenRepo={(path) => git.openRepo(path)}
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
    </>
  )
}

interface RepoPickerProps {
  recentRepos: string[]
  discoveredRepos: string[]
  workspaces: string[]
  activeWorkspace: string | null
  onSwitchWorkspace: (path: string) => Promise<void>
  onAddWorkspace: () => Promise<unknown>
  onRemoveWorkspace: (path: string) => Promise<void>
  onOpenRepo: (path: string) => void
}

function repoShortName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path
}

function RepoPicker({
  recentRepos,
  discoveredRepos,
  workspaces,
  activeWorkspace,
  onSwitchWorkspace,
  onAddWorkspace,
  onRemoveWorkspace,
  onOpenRepo
}: RepoPickerProps) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()

  const filter = (paths: string[]) => (q ? paths.filter((p) => p.toLowerCase().includes(q)) : paths)

  const filteredDiscovered = filter(discoveredRepos)
  const filteredRecent = filter(recentRepos)

  const hasAnyWorkspace = workspaces.length > 0 || !!activeWorkspace

  if (!hasAnyWorkspace) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <div className="flex max-w-sm flex-col items-center gap-4 text-center">
          <div className="rounded-full border bg-muted p-3">
            <FolderPlus className="size-5 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <h2 className="text-base font-semibold">Add a workspace</h2>
            <p className="text-sm text-muted-foreground">
              Repositories open from a workspace folder. Pick a folder that contains your Git
              repositories to get started.
            </p>
          </div>
          <Button onClick={() => onAddWorkspace()}>
            <FolderPlus />
            Add workspace…
          </Button>
        </div>
      </div>
    )
  }

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    const first = filteredRecent[0] ?? filteredDiscovered[0]
    if (first) onOpenRepo(first)
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
        <div className="flex items-center gap-3">
          <div className="rounded-md border bg-card p-2">
            <GitBranch className="size-4 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Open a repository</h2>
            <p className="text-sm text-muted-foreground">
              Pick a repository from your workspace or recents.
            </p>
          </div>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search repositories…"
            className="pl-9"
            aria-label="Search repositories"
            autoFocus
          />
        </div>

        <RepoGroup
          label="Recent"
          repos={filteredRecent}
          emptyText={
            q ? 'No matches' : recentRepos.length === 0 ? 'No recent repositories' : undefined
          }
          onSelect={onOpenRepo}
        />

        <RepoGroup
          label="Workspace"
          trailing={
            <WorkspaceSwitcher
              workspaces={workspaces}
              activeWorkspace={activeWorkspace}
              onSwitch={onSwitchWorkspace}
              onAdd={onAddWorkspace}
              onRemove={onRemoveWorkspace}
            />
          }
          repos={filteredDiscovered}
          emptyText={
            q
              ? 'No matches'
              : discoveredRepos.length === 0
                ? 'No repositories detected in this workspace'
                : undefined
          }
          onSelect={onOpenRepo}
        />
      </div>
    </div>
  )
}

interface RepoGroupProps {
  label: string
  trailing?: React.ReactNode
  repos: string[]
  emptyText?: string
  onSelect: (path: string) => void
}

function RepoGroup({ label, trailing, repos, emptyText, onSelect }: RepoGroupProps) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          {label}
        </h3>
        {trailing && <div className="min-w-0 max-w-xs">{trailing}</div>}
      </div>
      {repos.length > 0 ? (
        <ul className="flex flex-col">
          {repos.map((repo) => (
            <li key={repo}>
              <RepoRow path={repo} onSelect={onSelect} />
            </li>
          ))}
        </ul>
      ) : emptyText ? (
        <p className="px-3 py-2 text-sm text-muted-foreground">{emptyText}</p>
      ) : null}
    </section>
  )
}

interface RepoRowProps {
  path: string
  onSelect: (path: string) => void
}

function RepoRow({ path, onSelect }: RepoRowProps) {
  return (
    <Button
      variant="ghost"
      className="h-auto w-full justify-start gap-3 py-2 font-normal transition-none"
      onClick={() => onSelect(path)}
    >
      <Folder className="text-muted-foreground" />
      <span className="font-medium">{repoShortName(path)}</span>
      <span className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground">
        {path}
      </span>
    </Button>
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
  const branch = git.currentBranch || 'no-branch'
  const [activeView, setActiveView] = useState<SidebarView>('history')

  const sidebarBranches = useMemo(() => {
    const all = git.branches?.all ?? (branch ? [branch] : [])
    return all.map((name) => ({
      name,
      current: name === branch,
      ahead: 0,
      behind: 0
    }))
  }, [git.branches, branch])

  return (
    <Shell
      repoName={repoName}
      repoPath={git.repoPath}
      branch={branch}
      branches={sidebarBranches}
      ahead={0}
      behind={0}
      changes={totalChanges}
      activeBranch={branch}
      activeView={activeView}
      onSelectView={setActiveView}
      onSelectBranch={() => {
        /* branch switching not yet wired through useGit */
      }}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden p-2.5">
        {/* Always mounted so CommitPanel draft state survives view switches */}
        <div
          hidden={activeView !== 'local-changes'}
          className="grid min-h-0 flex-1 grid-cols-1 gap-2.5 overflow-hidden xl:grid-cols-[minmax(21rem,0.85fr)_minmax(0,1.15fr)]"
        >
          <div className="min-h-0 overflow-hidden">
            <StatusPanel
              status={git.status}
              onStage={git.stageFile}
              onUnstage={git.unstageFile}
              loading={git.loading}
            />
          </div>
          <div className="min-h-0 overflow-hidden">
            <CommitPanel onCommit={git.commit} loading={git.loading} />
          </div>
        </div>
        <div hidden={activeView !== 'history'} className="min-h-0 flex-1 overflow-hidden">
          <HistoryPanel log={git.log} loading={git.logLoading} remotes={git.remotes} />
        </div>
      </div>
      {/* counts kept available for screen readers / future use */}
      <span className="sr-only">
        {modifiedCount} modified, {stagedCount} staged, {untrackedCount} untracked
      </span>
    </Shell>
  )
}

export default App

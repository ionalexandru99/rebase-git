import { AlertCircle } from 'lucide-react'
import { useEffect } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useGit } from '@/hooks/useGit'
import { RepoPicker } from '@/RepoPicker'
import { Workspace } from '@/Workspace'

interface TabViewProps {
  tabId: string
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

export function TabView({
  tabId,
  recentRepos,
  discoveredRepos,
  workspaces,
  activeWorkspace,
  onSwitchWorkspace,
  onAddWorkspace,
  onRemoveWorkspace,
  onReportRepo,
  onRequestOpenRepo
}: TabViewProps) {
  const git = useGit()
  const modifiedCount = git.status?.modified.length ?? 0
  const stagedCount = git.status?.staged.length ?? 0
  const untrackedCount = git.status?.not_added.length ?? 0
  const totalChanges = modifiedCount + stagedCount + untrackedCount

  useEffect(() => {
    onReportRepo(tabId, git.repoPath ?? null)
  }, [git.repoPath, tabId, onReportRepo])

  const errorBanner = git.error ? (
    <div className="shrink-0 border-b px-4 py-2">
      <Alert variant="destructive" className="border-destructive/30">
        <AlertCircle />
        <AlertDescription>{git.error}</AlertDescription>
      </Alert>
    </div>
  ) : null

  if (!git.repoPath) {
    return (
      <>
        {errorBanner}
        <RepoPicker
          recentRepos={recentRepos}
          discoveredRepos={discoveredRepos}
          workspaces={workspaces}
          activeWorkspace={activeWorkspace}
          onSwitchWorkspace={onSwitchWorkspace}
          onAddWorkspace={onAddWorkspace}
          onRemoveWorkspace={onRemoveWorkspace}
          onOpenRepo={(path) => {
            if (!onRequestOpenRepo(tabId, path)) git.openRepo(path)
          }}
        />
      </>
    )
  }

  return (
    <Workspace
      git={git}
      modifiedCount={modifiedCount}
      stagedCount={stagedCount}
      untrackedCount={untrackedCount}
      totalChanges={totalChanges}
      errorBanner={errorBanner}
    />
  )
}

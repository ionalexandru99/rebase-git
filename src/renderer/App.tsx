import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ToastProvider } from '@/components/ui/toast'
import { CommitPanel } from './components/CommitPanel'
import { Header } from './components/Header'
import { HistoryPanel } from './components/HistoryPanel'
import { StatusPanel } from './components/StatusPanel'
import { useGit } from './hooks/useGit'

function App() {
  const git = useGit()
  const [recentRepos, setRecentRepos] = useState<string[]>([])

  useEffect(() => {
    window.electronAPI.getRecentRepos().then(setRecentRepos)
  }, [])

  const handleOpenRepo = useCallback(async () => {
    const path = await window.electronAPI.selectFolder()
    if (path) {
      await git.openRepo(path)
    }
  }, [git])

  return (
    <ToastProvider>
      <div className="flex flex-col h-screen bg-background text-foreground">
        <Header
          currentBranch={git.currentBranch}
          repoPath={git.repoPath}
          onOpenRepo={handleOpenRepo}
        />

        {git.error && (
          <div className="px-5 py-2 bg-destructive/20 text-destructive-foreground text-sm border-b border-destructive/30">
            {git.error}
          </div>
        )}

        {!git.repoPath ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-lg">
            <div className="text-center">
              <p className="mb-4">Open a git repository to get started</p>
              <Button size="lg" onClick={handleOpenRepo}>
                Open Repository
              </Button>
              {recentRepos.length > 0 && (
                <div className="mt-6">
                  <p className="text-sm mb-2 text-muted-foreground">Recent</p>
                  <ul className="space-y-1">
                    {recentRepos.map((repo) => (
                      <li key={repo}>
                        <Button
                          variant="link"
                          size="sm"
                          className="text-primary truncate max-w-md"
                          onClick={() => git.openRepo(repo)}
                          title={repo}
                        >
                          {repo}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 grid grid-cols-2 gap-5 p-5 overflow-hidden">
            <div className="flex flex-col gap-4 overflow-hidden">
              <StatusPanel
                status={git.status}
                onStage={git.stageFile}
                onUnstage={git.unstageFile}
                loading={git.loading}
              />
              <CommitPanel onCommit={git.commit} loading={git.loading} />
            </div>
            <HistoryPanel log={git.log} loading={git.loading} />
          </div>
        )}
      </div>
    </ToastProvider>
  )
}

export default App

import { AlertCircleIcon } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Alert, AlertDescription } from './components/ui/alert'
import { NewTab, type WorkspaceCatalog } from './NewTab'
import { GitStoreProvider, useRepoSession } from './stores/git'
import { Workspace } from './Workspace'

interface RepoTabProps {
  tabId: string
  tabActive: boolean
  repoPath: string
  catalog: WorkspaceCatalog
  onOpenRepo: (path: string) => void
  onRepoOpened: (path: string) => void
}

export function RepoTab(props: RepoTabProps) {
  return (
    <GitStoreProvider tabId={props.tabId} tabActive={props.tabActive}>
      <RepoTabContent {...props} />
    </GitStoreProvider>
  )
}

function RepoTabContent(props: RepoTabProps) {
  const session = useRepoSession()
  const lastRepoPathRequested = useRef<string | null>(null)

  useEffect(() => {
    if (props.repoPath !== lastRepoPathRequested.current) {
      const requestedPath = props.repoPath
      lastRepoPathRequested.current = requestedPath
      void session.openRepo(requestedPath).then((openedPath) => {
        if (lastRepoPathRequested.current === requestedPath && openedPath) {
          lastRepoPathRequested.current = openedPath
          props.onRepoOpened(openedPath)
        }
      })
    }
  }, [session.openRepo, props.repoPath, props.onRepoOpened])

  const errorBanner = session.error ? (
    <div className="shrink-0 border-b px-4 py-2">
      <Alert variant="destructive" className="border-destructive/30">
        <AlertCircleIcon />
        <AlertDescription>{session.error}</AlertDescription>
      </Alert>
    </div>
  ) : null

  if (session.repoPath) {
    return <Workspace tabActive={props.tabActive} errorBanner={errorBanner} />
  }

  return (
    <>
      {errorBanner}
      {session.opening ? <OpeningRepoState /> : null}
      {!session.opening && session.error ? (
        <NewTab catalog={props.catalog} onOpenRepo={props.onOpenRepo} />
      ) : null}
    </>
  )
}

function OpeningRepoState() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
      Opening repository...
    </div>
  )
}

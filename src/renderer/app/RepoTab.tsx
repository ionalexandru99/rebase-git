import type { RepoRef } from '@common/features/repository-identity'
import { AlertCircleIcon } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { repositoryIdentityKey } from '@/features/repository-identity'
import { Alert, AlertDescription } from '../components/ui/alert'
import { GitStoreProvider, useRepoSession } from '../stores/git'
import { NewTab, type WorkspaceCatalog } from './NewTab'
import { Workspace } from './Workspace'

interface RepoTabProps {
  tabId: string
  tabActive: boolean
  repoRef: RepoRef
  repoPath: string
  openRevision?: number
  catalog: WorkspaceCatalog
  onOpenRepo: (path: string) => void
  onRepoOpened: (path: string) => boolean
  onRepoOpenFailed: (path: string) => void
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
    const requestKey = `${repositoryIdentityKey(props.repoRef)}\0${props.openRevision ?? 0}\0${session.resetEpoch}`
    if (requestKey !== lastRepoPathRequested.current) {
      const requestedPath = props.repoPath
      lastRepoPathRequested.current = requestKey
      void session.openRepo(props.repoRef).then((openedPath) => {
        if (lastRepoPathRequested.current === requestKey && openedPath) {
          const retained = props.onRepoOpened(openedPath)
          if (retained === false) {
            session.disownRepo()
          } else {
            const openedRepoRef = { ...props.repoRef, path: openedPath }
            lastRepoPathRequested.current = `${repositoryIdentityKey(openedRepoRef)}\0${props.openRevision ?? 0}\0${session.resetEpoch}`
          }
          return
        }
        if (lastRepoPathRequested.current === requestKey) {
          props.onRepoOpenFailed(requestedPath)
        }
      })
    }
  }, [
    session.openRepo,
    session.disownRepo,
    session.resetEpoch,
    props.repoPath,
    props.repoRef,
    props.openRevision,
    props.onRepoOpened,
    props.onRepoOpenFailed
  ])

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

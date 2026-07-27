import { useState } from 'react'
import { CloneRepoDialog } from '../features/repos/CloneRepoDialog'
import { RepoPicker } from '../features/repos/RepoPicker'

interface WorkspaceCatalog {
  recentRepos: string[]
  discoveredRepos: string[]
  workspaces: string[]
  activeWorkspace: string | null
  switchWorkspace: (path: string) => Promise<void>
  addWorkspace: () => Promise<unknown>
  removeWorkspace: (path: string) => Promise<void>
}

interface NewTabProps {
  catalog: WorkspaceCatalog
  onOpenRepo: (path: string) => void
}

export function NewTab(props: NewTabProps) {
  const [cloning, setCloning] = useState(false)

  return (
    <>
      <RepoPicker
        recentRepos={props.catalog.recentRepos}
        discoveredRepos={props.catalog.discoveredRepos}
        workspaces={props.catalog.workspaces}
        activeWorkspace={props.catalog.activeWorkspace}
        onSwitchWorkspace={props.catalog.switchWorkspace}
        onAddWorkspace={props.catalog.addWorkspace}
        onRemoveWorkspace={props.catalog.removeWorkspace}
        onOpenRepo={props.onOpenRepo}
        onCloneRepo={() => setCloning(true)}
      />
      {cloning && (
        <CloneRepoDialog
          defaultParentDir={props.catalog.activeWorkspace}
          onSelectParentDir={() => window.electronAPI.selectFolder()}
          onCloned={(repoPath) => {
            setCloning(false)
            props.onOpenRepo(repoPath)
          }}
          onClose={() => setCloning(false)}
        />
      )}
    </>
  )
}

export type { WorkspaceCatalog }

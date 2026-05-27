import { RepoPicker } from './RepoPicker'

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
  return (
    <RepoPicker
      recentRepos={props.catalog.recentRepos}
      discoveredRepos={props.catalog.discoveredRepos}
      workspaces={props.catalog.workspaces}
      activeWorkspace={props.catalog.activeWorkspace}
      onSwitchWorkspace={props.catalog.switchWorkspace}
      onAddWorkspace={props.catalog.addWorkspace}
      onRemoveWorkspace={props.catalog.removeWorkspace}
      onOpenRepo={props.onOpenRepo}
    />
  )
}

export type { WorkspaceCatalog }

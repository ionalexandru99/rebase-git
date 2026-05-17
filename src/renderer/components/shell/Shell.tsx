import type { ReactNode } from 'react'
import { Sidebar, type SidebarView } from './Sidebar'
import { Statusbar } from './Statusbar'
import { Topbar } from './Topbar'

interface ShellProps {
  repoName: string
  repoPath: string | null
  branch: string
  branches: { name: string; current: boolean; ahead?: number; behind?: number }[]
  ahead: number
  behind: number
  changes: number
  activeBranch: string
  activeView: SidebarView
  onSelectView: (view: SidebarView) => void
  onSelectBranch: (name: string) => void
  onFetch?: () => void
  onPull?: () => void
  onPush?: () => void
  children: ReactNode
}

export function Shell({
  repoName,
  repoPath,
  branch,
  branches,
  ahead,
  behind,
  changes,
  activeBranch,
  activeView,
  onSelectView,
  onSelectBranch,
  onFetch,
  onPull,
  onPush,
  children
}: ShellProps) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-fg">
      <Topbar
        repoName={repoName}
        repoPath={repoPath}
        branch={branch}
        ahead={ahead}
        behind={behind}
        onFetch={onFetch}
        onPull={onPull}
        onPush={onPush}
      />
      <div className="flex min-h-0 flex-1 border-t border-border">
        <Sidebar
          branches={branches}
          workingChanges={changes}
          activeBranch={activeBranch}
          activeView={activeView}
          onSelectView={onSelectView}
          onSelectBranch={onSelectBranch}
        />
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
          {children}
        </div>
      </div>
      <Statusbar
        branch={branch}
        ahead={ahead}
        behind={behind}
        changes={changes}
        directionLabel="History"
      />
    </div>
  )
}

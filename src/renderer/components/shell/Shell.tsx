import type { ReactNode } from 'react'
import { Sidebar } from './Sidebar'
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
  onSelectBranch: (name: string) => void
  onSwitchRepo?: () => void
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
  onSelectBranch,
  onSwitchRepo,
  onFetch,
  onPull,
  onPush,
  children
}: ShellProps) {
  return (
    <div className="shell-app">
      <Topbar
        repoName={repoName}
        repoPath={repoPath}
        branch={branch}
        ahead={ahead}
        behind={behind}
        onSwitchRepo={onSwitchRepo}
        onFetch={onFetch}
        onPull={onPull}
        onPush={onPush}
      />
      <div className="shell-body">
        <Sidebar
          branches={branches}
          workingChanges={changes}
          activeBranch={activeBranch}
          onSelectBranch={onSelectBranch}
        />
        <div className="shell-main">{children}</div>
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

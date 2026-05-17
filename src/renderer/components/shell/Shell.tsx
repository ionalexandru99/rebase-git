import { type ReactNode, useEffect, useState } from 'react'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { AppSidebar, type SidebarView } from './Sidebar'
import { Statusbar } from './Statusbar'
import { Topbar } from './Topbar'

const SIDEBAR_STORE_KEY = 'sidebarOpen'

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
  const [open, setOpen] = useState(true)

  useEffect(() => {
    let cancelled = false
    Promise.resolve(window.electronAPI.getStoreValue(SIDEBAR_STORE_KEY)).then((v) => {
      if (cancelled) return
      if (typeof v === 'boolean') setOpen(v)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    window.electronAPI.setStoreValue(SIDEBAR_STORE_KEY, next)
  }

  return (
    <SidebarProvider open={open} onOpenChange={handleOpenChange} className="!min-h-0 h-full">
      <AppSidebar
        branches={branches}
        workingChanges={changes}
        activeBranch={activeBranch}
        activeView={activeView}
        onSelectView={onSelectView}
        onSelectBranch={onSelectBranch}
      />
      <SidebarInset className="flex min-h-0 flex-col">
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
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t">{children}</div>
        <Statusbar
          branch={branch}
          ahead={ahead}
          behind={behind}
          changes={changes}
          directionLabel="History"
        />
      </SidebarInset>
    </SidebarProvider>
  )
}

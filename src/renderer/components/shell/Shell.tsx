import { decodeOrThrow } from '@shared/codec'
import { SidebarPrefs } from '@shared/schemas/ipc'
import { type ReactNode, useCallback } from 'react'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { useDraggableWidth } from '@/hooks/useDraggableWidth'
import type { BranchTracking, RefKind } from '@/lib/ref-tree'
import { AppSidebar, type SidebarView } from './Sidebar'
import { Statusbar } from './Statusbar'
import { Topbar } from './Topbar'

const SIDEBAR_WIDTH_MIN = 200
const SIDEBAR_WIDTH_MAX = 520
const SIDEBAR_WIDTH_DEFAULT = 256

interface ShellProps {
  repoName: string
  repoPath: string | null
  branch: string
  localBranches: string[]
  remoteBranches: string[]
  tags: string[]
  branchesLoading?: boolean
  changes: number
  activeView: SidebarView
  tracking?: Record<string, BranchTracking>
  onSelectView: (view: SidebarView) => void
  onFetch?: () => void
  onCheckoutRef?: (refKind: RefKind, fullPath: string) => void
  children: ReactNode
}

const loadSidebarPrefs = () => window.electronAPI.getSidebarPrefs()
const saveSidebarPrefs = (state: { open: boolean; width: number }) =>
  window.electronAPI.setSidebarPrefs(state)
const decodeSidebarPrefs = (raw: { open: boolean; width: number }) =>
  decodeOrThrow(SidebarPrefs, raw)
const logSidebarPrefsError = (err: unknown) => {
  console.warn('[Shell] failed to load sidebar prefs', err)
}

export function Shell({
  repoName,
  repoPath,
  branch,
  localBranches,
  remoteBranches,
  tags,
  branchesLoading = false,
  changes,
  activeView,
  tracking,
  onSelectView,
  onFetch,
  onCheckoutRef,
  children
}: ShellProps) {
  const { width, isOpen, setOpen, onResizeStart } = useDraggableWidth({
    min: SIDEBAR_WIDTH_MIN,
    max: SIDEBAR_WIDTH_MAX,
    defaultWidth: SIDEBAR_WIDTH_DEFAULT,
    load: loadSidebarPrefs,
    save: saveSidebarPrefs,
    decode: decodeSidebarPrefs,
    onLoadError: logSidebarPrefsError
  })

  const handleOpenChange = useCallback((next: boolean) => setOpen(next), [setOpen])

  return (
    <SidebarProvider
      open={isOpen}
      onOpenChange={handleOpenChange}
      className="!min-h-0 h-full"
      style={{ '--sidebar-width': `${width}px` } as React.CSSProperties}
    >
      <AppSidebar
        localBranches={localBranches}
        remoteBranches={remoteBranches}
        tags={tags}
        currentBranch={branch}
        branchesLoading={branchesLoading}
        workingChanges={changes}
        activeView={activeView}
        tracking={tracking}
        onSelectView={onSelectView}
        onResizeStart={onResizeStart}
        onCheckoutRef={onCheckoutRef}
      />
      <SidebarInset className="flex min-h-0 flex-col">
        <Topbar repoName={repoName} repoPath={repoPath} branch={branch} onFetch={onFetch} />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t">{children}</div>
        <Statusbar branch={branch} changes={changes} directionLabel="History" />
      </SidebarInset>
    </SidebarProvider>
  )
}

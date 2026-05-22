import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { AppSidebar, type SidebarView } from './Sidebar'
import { Statusbar } from './Statusbar'
import { Topbar } from './Topbar'

const SIDEBAR_STORE_KEY = 'sidebarOpen'
const SIDEBAR_WIDTH_STORE_KEY = 'sidebarWidth'
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
  onSelectView: (view: SidebarView) => void
  onFetch?: () => void
  children: ReactNode
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
  onSelectView,
  onFetch,
  children
}: ShellProps) {
  const [open, setOpen] = useState(true)
  const [width, setWidth] = useState<number>(SIDEBAR_WIDTH_DEFAULT)
  const dragWidthRef = useRef(width)

  useEffect(() => {
    let cancelled = false
    Promise.resolve(window.electronAPI.getStoreValue(SIDEBAR_STORE_KEY)).then((v) => {
      if (cancelled) return
      if (typeof v === 'boolean') setOpen(v)
    })
    Promise.resolve(window.electronAPI.getStoreValue(SIDEBAR_WIDTH_STORE_KEY)).then((v) => {
      if (cancelled) return
      if (typeof v === 'number' && Number.isFinite(v)) {
        const clamped = Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, v))
        setWidth(clamped)
        dragWidthRef.current = clamped
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    window.electronAPI.setStoreValue(SIDEBAR_STORE_KEY, next)
  }

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startW = width
      dragWidthRef.current = startW
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      document.body.dataset.sidebarResizing = 'true'
      const onMove = (ev: MouseEvent) => {
        const next = Math.max(
          SIDEBAR_WIDTH_MIN,
          Math.min(SIDEBAR_WIDTH_MAX, startW + (ev.clientX - startX))
        )
        dragWidthRef.current = next
        setWidth(next)
      }
      const onUp = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        delete document.body.dataset.sidebarResizing
        window.electronAPI.setStoreValue(SIDEBAR_WIDTH_STORE_KEY, dragWidthRef.current)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [width]
  )

  return (
    <SidebarProvider
      open={open}
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
        onSelectView={onSelectView}
        onResizeStart={handleResizeStart}
      />
      <SidebarInset className="flex min-h-0 flex-col">
        <Topbar repoName={repoName} repoPath={repoPath} branch={branch} onFetch={onFetch} />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t">{children}</div>
        <Statusbar branch={branch} changes={changes} directionLabel="History" />
      </SidebarInset>
    </SidebarProvider>
  )
}

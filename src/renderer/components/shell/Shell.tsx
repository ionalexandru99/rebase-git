import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import type { RefKind } from './RefTreePanel'
import { AppSidebar, type SidebarView } from './Sidebar'
import { Statusbar } from './Statusbar'
import { Topbar } from './Topbar'

const SIDEBAR_STORE_KEY = 'sidebarOpen'
const SIDEBAR_WIDTH_STORE_KEY = 'sidebarWidth'
// Width bounds in px. Min keeps branch names legible; max leaves room for the
// commit timeline. Default matches shadcn's stock `--sidebar-width` (16rem).
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
  ahead: number
  behind: number
  changes: number
  activeView: SidebarView
  onSelectView: (view: SidebarView) => void
  onSelectRef?: (refKind: RefKind, fullPath: string) => void
  onFetch?: () => void
  onPull?: () => void
  onPush?: () => void
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
  ahead,
  behind,
  changes,
  activeView,
  onSelectView,
  onSelectRef,
  onFetch,
  onPull,
  onPush,
  children
}: ShellProps) {
  const [open, setOpen] = useState(true)
  const [width, setWidth] = useState<number>(SIDEBAR_WIDTH_DEFAULT)
  // Latest width during a drag — written every mousemove so we can persist the
  // final value on mouseup without depending on stale React state.
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
      // Read by the global rule in index.css to disable the shadcn sidebar's
      // width transition while the user is actively dragging — otherwise the
      // sidebar lags ~200ms behind the cursor.
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
        onSelectRef={onSelectRef}
        onResizeStart={handleResizeStart}
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

import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { Sidebar, type SidebarView } from './Sidebar'
import { Statusbar } from './Statusbar'
import { Topbar } from './Topbar'

// Bounds for sidebar resize. Default matches the old `w-61` (~244px).
const SIDEBAR_DEFAULT = 244
const SIDEBAR_MIN = 160
const SIDEBAR_MAX = 480
const SIDEBAR_STORE_KEY = 'sidebarWidth'

function clampSidebar(n: number): number {
  return Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, n))
}

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
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT)

  // Load persisted width on mount. `Promise.resolve` tolerates both a real
  // IPC promise and test mocks that return undefined synchronously.
  useEffect(() => {
    let cancelled = false
    Promise.resolve(window.electronAPI.getStoreValue(SIDEBAR_STORE_KEY)).then((v) => {
      if (cancelled) return
      if (typeof v === 'number' && Number.isFinite(v)) {
        setSidebarWidth(clampSidebar(v))
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const startSidebarResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startW = sidebarWidth
      let last = startW
      const onMove = (ev: MouseEvent) => {
        last = clampSidebar(startW + (ev.clientX - startX))
        setSidebarWidth(last)
      }
      const onUp = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        // Persist once, after the drag settles — one IPC, not one per frame.
        window.electronAPI.setStoreValue(SIDEBAR_STORE_KEY, last)
      }
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [sidebarWidth]
  )

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
          width={sidebarWidth}
        />
        {/* biome-ignore lint/a11y/noStaticElementInteractions: mouse-only resize handle; no keyboard equivalent */}
        <div
          onMouseDown={startSidebarResize}
          className="group/sbres relative -ml-0.5 w-1.5 shrink-0 cursor-col-resize select-none"
        >
          {/* Always-visible faint marker so users discover the handle; brightens
              to the accent color on hover. Sits over the sidebar's own
              border-r, replacing it visually when hovered. */}
          <span className="pointer-events-none absolute inset-y-2 left-1/2 w-px -translate-x-1/2 bg-border group-hover/sbres:inset-y-0 group-hover/sbres:w-0.5 group-hover/sbres:bg-primary/70" />
        </div>
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

import { parseOrThrow } from '@shared/codec'
import { SidebarPrefsSchema } from '@shared/schemas/ipc'
import { type ReactNode, useEffect, useState } from 'react'
import type { BranchAction, StashAction } from '@/lib/git-actions'
import { LAYOUT_RESET_EVENT } from '@/lib/layout'
import type { BranchTracking, RefKind, StashRowData } from '@/lib/ref-tree'
import type { PushForce } from '@/lib/rpc-client'
import type { PushOutcome } from '@/stores/action-runner'
import { useDraggableWidth } from '../../hooks/useDraggableWidth'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { AppSidebar } from './Sidebar'
import { Topbar, type WorkspaceView } from './Topbar'

type TopbarPush = (force?: PushForce, expectedRemoteSha?: string) => Promise<PushOutcome>

const SIDEBAR_WIDTH_MIN = 200
const SIDEBAR_WIDTH_MAX = 520
const SIDEBAR_WIDTH_DEFAULT = 256

export interface RepoChrome {
  repoName: string
  repoPath: string | null
  branch: string
  changes: number
}

export interface BranchBrowser {
  repoPath: string | null
  localBranches: string[]
  remoteBranches: string[]
  tags: string[]
  stashes?: StashRowData[]
  branchesLoading?: boolean
  tracking?: Record<string, BranchTracking>
  visibleTimelineRefs?: ReadonlySet<string>
  onToggleTimelineVisibility?: (refKind: RefKind, fullPath: string) => void
  onCheckoutRef?: (refKind: RefKind, fullPath: string) => void
  onBranchAction?: (action: BranchAction, refKind: RefKind, fullPath: string) => void
  onStashAction?: (action: StashAction, index: number, expectedOid: string) => void
}

export interface WorkspaceNavigation {
  activeView: WorkspaceView
  onSelectView: (view: WorkspaceView) => void
}

interface ShellProps {
  repo: RepoChrome
  branchBrowser: BranchBrowser
  navigation: WorkspaceNavigation
  lastFetchedAt?: number | null
  onFetch?: () => void
  onPull?: () => void
  push?: TopbarPush
  ahead?: number
  behind?: number
  detached?: boolean
  pulling?: boolean
  pushing?: boolean
  busy?: boolean
  children: ReactNode
}

const loadSidebarPrefs = () => window.electronAPI.getSidebarPrefs()
const saveSidebarPrefs = (state: { open: boolean; width: number }) =>
  window.electronAPI.setSidebarPrefs(state)
const decodeSidebarPrefs = (raw: { open: boolean; width: number }) =>
  parseOrThrow(SidebarPrefsSchema, raw)
const logSidebarPrefsError = (err: unknown) => {
  console.warn('[Shell] failed to load sidebar prefs', err)
}

export function Shell(props: ShellProps) {
  const { width, isOpen, setOpen, onResizeStart } = useDraggableWidth({
    min: SIDEBAR_WIDTH_MIN,
    max: SIDEBAR_WIDTH_MAX,
    defaultWidth: SIDEBAR_WIDTH_DEFAULT,
    load: loadSidebarPrefs,
    save: saveSidebarPrefs,
    decode: decodeSidebarPrefs,
    onLoadError: logSidebarPrefsError
  })
  const compact = useMediaQuery('(max-width: 899px)')
  const [compactSidebarOpen, setCompactSidebarOpen] = useState(false)

  useEffect(() => {
    if (compact) {
      setCompactSidebarOpen(false)
    }
  }, [compact])

  const sidebarOpen = compact ? compactSidebarOpen : isOpen
  const toggleSidebar = () => {
    if (compact) {
      setCompactSidebarOpen((open) => !open)
      return
    }
    setOpen(!isOpen)
  }
  const resetLayout = () => {
    window.dispatchEvent(new Event(LAYOUT_RESET_EVENT))
    setCompactSidebarOpen(false)
  }

  return (
    <div
      className="relative grid h-full min-h-0 gap-1.5 bg-chrome p-1.5"
      style={{
        gridTemplateColumns:
          sidebarOpen && !compact
            ? `min(${width}px, calc(100vw - 520px)) minmax(0, 1fr)`
            : 'minmax(0, 1fr)'
      }}
    >
      {sidebarOpen ? (
        <>
          {compact ? (
            <button
              type="button"
              aria-label="Dismiss branches overlay"
              onClick={() => setCompactSidebarOpen(false)}
              className="absolute inset-0 z-40 bg-black/40"
            />
          ) : null}
          <div
            className={compact ? 'absolute inset-y-1.5 left-1.5 z-50' : 'min-h-0 min-w-0'}
            style={compact ? { width: `min(${width}px, calc(100vw - 4rem))` } : undefined}
          >
            <AppSidebar
              branchBrowser={props.branchBrowser}
              currentBranch={props.repo.branch}
              onClose={compact ? () => setCompactSidebarOpen(false) : undefined}
              onResizeStart={compact ? undefined : (event) => onResizeStart(event.nativeEvent)}
            />
          </div>
        </>
      ) : null}

      <section className="relative z-[1] grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-[var(--r-sm)] border bg-card shadow-[var(--shadow)]">
        <Topbar
          repoName={props.repo.repoName}
          repoPath={props.repo.repoPath}
          activeView={props.navigation.activeView}
          onSelectView={props.navigation.onSelectView}
          lastFetchedAt={props.lastFetchedAt}
          onFetch={props.onFetch}
          onPull={props.onPull}
          push={props.push}
          branch={props.repo.branch}
          ahead={props.ahead}
          behind={props.behind}
          detached={props.detached}
          pulling={props.pulling}
          pushing={props.pushing}
          busy={props.busy}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={toggleSidebar}
          onResetLayout={resetLayout}
        />
        <div className="flex min-h-0 flex-col overflow-hidden">{props.children}</div>
      </section>
    </div>
  )
}

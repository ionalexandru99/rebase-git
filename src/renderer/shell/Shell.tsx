import { parseOrThrow } from '@shared/codec'
import { SidebarPrefsSchema } from '@shared/schemas/ipc'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import type { BranchTracking, RefKind, StashRowData } from '@/features/refs/ref-tree'
import { COMPACT_MEDIA_QUERY, MIN_CONTENT_WIDTH } from '@/lib/breakpoints'
import type { BranchAction, StashAction } from '@/lib/git-actions'
import { LAYOUT_RESET_EVENT } from '@/lib/layout'
import type { PushForce } from '@/lib/rpc-client'
import type { PushOutcome } from '@/stores/action-runner'
import { useDraggablePane } from '../hooks/useDraggablePane'
import { useMediaQuery } from '../hooks/useMediaQuery'
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

const loadSidebarPrefs = async () => {
  const prefs = parseOrThrow(SidebarPrefsSchema, await window.electronAPI.getSidebarPrefs())
  return { open: prefs.open, size: prefs.width }
}
const saveSidebarPrefs = (state: { open: boolean; size: number }) =>
  window.electronAPI.setSidebarPrefs({ open: state.open, width: state.size })
const logSidebarPrefsError = (err: unknown) => {
  console.warn('[Shell] failed to load sidebar prefs', err)
}

export function Shell(props: ShellProps) {
  const {
    size: width,
    isOpen,
    setOpen,
    onResizeStart
  } = useDraggablePane({
    min: SIDEBAR_WIDTH_MIN,
    max: SIDEBAR_WIDTH_MAX,
    defaultSize: SIDEBAR_WIDTH_DEFAULT,
    load: loadSidebarPrefs,
    save: saveSidebarPrefs,
    onLoadError: logSidebarPrefsError
  })
  const compact = useMediaQuery(COMPACT_MEDIA_QUERY)
  const [compactSidebarOpen, setCompactSidebarOpen] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)
  const sidebarToggleRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (compact) {
      setCompactSidebarOpen(false)
    }
  }, [compact])

  useEffect(() => {
    if (!compact || !compactSidebarOpen) {
      return
    }
    const toggleButton = sidebarToggleRef.current
    overlayRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setCompactSidebarOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      toggleButton?.focus()
    }
  }, [compact, compactSidebarOpen])

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

  const sidebar = (
    <AppSidebar
      branchBrowser={props.branchBrowser}
      currentBranch={props.repo.branch}
      onClose={compact ? () => setCompactSidebarOpen(false) : undefined}
      onResizeStart={compact ? undefined : (event) => onResizeStart(event.nativeEvent)}
    />
  )

  return (
    <div
      className="relative grid h-full min-h-0 gap-1.5 bg-chrome p-1.5"
      style={{
        gridTemplateColumns:
          sidebarOpen && !compact
            ? `min(${width}px, calc(100% - ${MIN_CONTENT_WIDTH}px)) minmax(0, 1fr)`
            : 'minmax(0, 1fr)'
      }}
    >
      {sidebarOpen && compact ? (
        <>
          <div
            aria-hidden="true"
            onClick={() => setCompactSidebarOpen(false)}
            className="absolute inset-0 z-40 bg-black/40"
          />
          <div
            ref={overlayRef}
            role="dialog"
            aria-modal="true"
            aria-label="Branches"
            tabIndex={-1}
            className="absolute inset-y-1.5 left-1.5 z-50 outline-none"
            style={{ width: `min(${width}px, calc(100vw - 4rem))` }}
          >
            {sidebar}
          </div>
        </>
      ) : null}
      {sidebarOpen && !compact ? <div className="min-h-0 min-w-0">{sidebar}</div> : null}

      <section
        inert={compact && sidebarOpen}
        className="relative z-[1] grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-[var(--r-sm)] border bg-card shadow-[var(--shadow)]"
      >
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
          compact={compact}
          sidebarOpen={sidebarOpen}
          sidebarToggleRef={sidebarToggleRef}
          onToggleSidebar={toggleSidebar}
          onResetLayout={resetLayout}
        />
        <div className="flex min-h-0 flex-col overflow-hidden">{props.children}</div>
      </section>
    </div>
  )
}

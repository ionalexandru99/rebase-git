import {
  clampListPaneWidth,
  LIST_PANE_DEFAULT_WIDTH,
  LIST_PANE_MAX_WIDTH,
  LIST_PANE_MIN_WIDTH
} from '@shared/list-layout'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import type { BranchTracking, RefKind, StashRowData } from '@/features/refs/ref-tree'
import type { BranchAction, StashAction } from '@/lib/git-actions'
import { useDraggablePane } from '../hooks/useDraggablePane'
import { AppSidebar } from './Sidebar'

export const COLUMN_HEADER_HEIGHT = 34
export const REFS_COLUMN_WIDTH = 214
export const REFS_COLUMN_MIN_WIDTH = 180
export const REFS_COLUMN_MAX_WIDTH = 420
export const STATUS_DOCK_HEIGHT = 26
const DIVIDER_WIDTH = 6

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

interface ShellProps {
  repoPath: string | null
  currentBranch: string
  branchBrowser: BranchBrowser
  banner?: ReactNode
  listHeader: ReactNode
  listBody: ReactNode
  detailPane: ReactNode
  statusDock: ReactNode
  children?: ReactNode
}

const logListPaneWidthError = (error: unknown) => {
  console.warn('[Shell] failed to load the commit list width', error)
}

const logSidebarWidthError = (error: unknown) => {
  console.warn('[Shell] failed to load the branches panel width', error)
}

const loadSidebarWidth = async () => {
  const prefs = await window.electronAPI.getSidebarPrefs()
  return { open: true, size: prefs.width }
}

const saveSidebarWidth = (state: { size: number }) => {
  return window.electronAPI.setSidebarPrefs({ open: true, width: state.size })
}

export function Shell(props: ShellProps) {
  const repoPath = props.repoPath
  const load = useCallback(async () => {
    const stored = repoPath ? await window.electronAPI.getListPaneWidth(repoPath) : null
    return {
      open: true,
      size: clampListPaneWidth(stored ?? LIST_PANE_DEFAULT_WIDTH)
    }
  }, [repoPath])
  const save = useCallback(
    (state: { size: number }) => {
      if (!repoPath) {
        return
      }
      return window.electronAPI.setListPaneWidth(repoPath, clampListPaneWidth(state.size))
    },
    [repoPath]
  )

  const {
    size: listWidth,
    loaded: listWidthLoaded,
    reset: resetListWidth,
    onResizeStart
  } = useDraggablePane({
    min: LIST_PANE_MIN_WIDTH,
    max: LIST_PANE_MAX_WIDTH,
    defaultSize: LIST_PANE_DEFAULT_WIDTH,
    handle: 'end',
    load,
    save,
    onLoadError: logListPaneWidthError
  })

  const {
    size: refsWidth,
    loaded: refsWidthLoaded,
    reset: resetRefsWidth,
    onResizeStart: onRefsResizeStart
  } = useDraggablePane({
    min: REFS_COLUMN_MIN_WIDTH,
    max: REFS_COLUMN_MAX_WIDTH,
    defaultSize: REFS_COLUMN_WIDTH,
    handle: 'end',
    load: loadSidebarWidth,
    save: saveSidebarWidth,
    onLoadError: logSidebarWidthError
  })

  const [dragging, setDragging] = useState(false)
  const [refsDragging, setRefsDragging] = useState(false)

  useEffect(() => {
    if (!dragging && !refsDragging) {
      return
    }
    const stop = () => {
      setDragging(false)
      setRefsDragging(false)
    }
    window.addEventListener('mouseup', stop)
    return () => window.removeEventListener('mouseup', stop)
  }, [dragging, refsDragging])

  const startResize = (event: MouseEvent) => {
    setDragging(true)
    onResizeStart(event)
  }

  const startRefsResize = (event: MouseEvent) => {
    setRefsDragging(true)
    onRefsResizeStart(event)
  }

  return (
    <div
      className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] bg-chrome"
      data-testid="repo-shell"
    >
      {props.banner}

      <div
        className="row-start-2 grid min-h-0 min-w-0 overflow-hidden"
        style={{
          gridTemplateColumns: `${refsWidth}px ${DIVIDER_WIDTH}px ${listWidth}px ${DIVIDER_WIDTH}px minmax(0, 1fr)`
        }}
      >
        <AppSidebar
          branchBrowser={props.branchBrowser}
          currentBranch={props.currentBranch}
          width={refsWidth}
        />

        <div className="relative">
          {refsWidthLoaded ? (
            <button
              type="button"
              aria-label="Resize branches panel"
              title={`Branches panel width: ${refsWidth}px — double-click to reset`}
              onMouseDown={(event) => startRefsResize(event.nativeEvent)}
              onDoubleClick={resetRefsWidth}
              className="group/refs-resize flex h-full w-full cursor-col-resize items-stretch justify-center bg-chrome"
            >
              <span className="w-px bg-border-strong/40 transition-colors group-hover/refs-resize:bg-primary/70" />
            </button>
          ) : null}
          {refsDragging ? (
            <span
              data-testid="refs-width-tooltip"
              className="pointer-events-none absolute left-3 top-2 z-50 whitespace-nowrap rounded-[var(--r-xs)] border bg-popover px-1.5 py-0.5 text-xs tabular-nums text-popover-foreground shadow-[var(--shadow)]"
            >
              {refsWidth}px
            </span>
          ) : null}
        </div>

        <section
          aria-label="Commits"
          style={{ width: `${listWidth}px` }}
          className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r bg-card"
        >
          <div
            style={{ height: `${COLUMN_HEADER_HEIGHT}px` }}
            className="flex shrink-0 items-center gap-1.5 border-b px-1.5"
          >
            {props.listHeader}
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{props.listBody}</div>
        </section>

        <div className="relative">
          {listWidthLoaded ? (
            <button
              type="button"
              aria-label="Resize commit list"
              title={`Commit list width: ${listWidth}px — double-click to reset`}
              onMouseDown={(event) => startResize(event.nativeEvent)}
              onDoubleClick={resetListWidth}
              className="group/list-resize flex h-full w-full cursor-col-resize items-stretch justify-center bg-chrome"
            >
              <span className="w-px bg-border-strong/40 transition-colors group-hover/list-resize:bg-primary/70" />
            </button>
          ) : null}
          {dragging ? (
            <span
              data-testid="list-pane-width-tooltip"
              className="pointer-events-none absolute left-3 top-2 z-50 whitespace-nowrap rounded-[var(--r-xs)] border bg-popover px-1.5 py-0.5 text-xs tabular-nums text-popover-foreground shadow-[var(--shadow)]"
            >
              {listWidth}px
            </span>
          ) : null}
        </div>

        <section
          aria-label="Details"
          className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-card"
        >
          {props.detailPane}
        </section>
      </div>

      <div
        style={{ height: `${STATUS_DOCK_HEIGHT}px` }}
        className="row-start-3 min-w-0 shrink-0 border-t"
      >
        {props.statusDock}
      </div>

      {props.children}
    </div>
  )
}

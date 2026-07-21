import { parseOrThrow } from '@shared/codec'
import { SidebarPrefsSchema } from '@shared/schemas/ipc'
import type { ReactNode } from 'react'
import type { BranchAction, StashAction } from '@/lib/git-actions'
import type { BranchTracking, RefKind, StashRowData } from '@/lib/ref-tree'
import type { PushForce } from '@/lib/rpc-client'
import type { PushOutcome } from '@/stores/action-runner'
import { useDraggableWidth } from '../../hooks/useDraggableWidth'
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
  const { width, onResizeStart } = useDraggableWidth({
    min: SIDEBAR_WIDTH_MIN,
    max: SIDEBAR_WIDTH_MAX,
    defaultWidth: SIDEBAR_WIDTH_DEFAULT,
    load: loadSidebarPrefs,
    save: saveSidebarPrefs,
    decode: decodeSidebarPrefs,
    onLoadError: logSidebarPrefsError
  })

  return (
    <div
      className="grid h-full min-h-0 gap-1.5 bg-chrome p-1.5"
      style={{ gridTemplateColumns: `${width}px minmax(0, 1fr)` }}
    >
      <AppSidebar
        branchBrowser={props.branchBrowser}
        currentBranch={props.repo.branch}
        onResizeStart={(event) => onResizeStart(event.nativeEvent)}
      />

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
        />
        <div className="flex min-h-0 flex-col overflow-hidden">{props.children}</div>
      </section>
    </div>
  )
}

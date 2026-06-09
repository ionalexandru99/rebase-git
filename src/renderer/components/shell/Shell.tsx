import { parseOrThrow } from '@shared/codec'
import { SidebarPrefsSchema } from '@shared/schemas/ipc'
import type { JSX } from '@/lib/react-compat'
import type { BranchTracking, RefKind } from '@/lib/ref-tree'
import { useDraggableWidth } from '../../hooks/useDraggableWidth'
import { AppSidebar } from './Sidebar'
import { Topbar, type WorkspaceView } from './Topbar'

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
  localBranches: string[]
  remoteBranches: string[]
  tags: string[]
  branchesLoading?: boolean
  tracking?: Record<string, BranchTracking>
  visibleTimelineRefs?: ReadonlySet<string>
  onToggleTimelineVisibility?: (refKind: RefKind, fullPath: string) => void
  onCheckoutRef?: (refKind: RefKind, fullPath: string) => void
}

export interface WorkspaceNavigation {
  activeView: WorkspaceView
  onSelectView: (view: WorkspaceView) => void
}

interface ShellProps {
  repo: RepoChrome
  branchBrowser: BranchBrowser
  navigation: WorkspaceNavigation
  workspaceContext?: string
  onFetch?: () => void
  onPull?: () => void
  onPush?: () => void
  pulling?: boolean
  pushing?: boolean
  children: JSX.Element
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
      style={{ gridTemplateColumns: `${width()}px minmax(0, 1fr)` }}
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
          workspaceContext={props.workspaceContext}
          onFetch={props.onFetch}
          onPull={props.onPull}
          onPush={props.onPush}
          pulling={props.pulling}
          pushing={props.pushing}
        />
        <div className="flex min-h-0 flex-col overflow-hidden">{props.children}</div>
      </section>
    </div>
  )
}

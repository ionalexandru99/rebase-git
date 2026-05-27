import { parseOrThrow } from '@shared/codec'
import { SidebarPrefsSchema } from '@shared/schemas/ipc'
import type { JSX } from '@/lib/react-compat'
import type { BranchTracking, RefKind } from '@/lib/ref-tree'
import { useDraggableWidth } from '../../hooks/useDraggableWidth'
import { SidebarInset, SidebarProvider } from '../ui/sidebar'
import { AppSidebar, type SidebarView } from './Sidebar'
import { Statusbar } from './Statusbar'
import { Topbar } from './Topbar'

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
  activeView: SidebarView
  onSelectView: (view: SidebarView) => void
}

interface ShellProps {
  repo: RepoChrome
  branchBrowser: BranchBrowser
  navigation: WorkspaceNavigation
  onFetch?: () => void
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
  const { width, isOpen, setOpen, onResizeStart } = useDraggableWidth({
    min: SIDEBAR_WIDTH_MIN,
    max: SIDEBAR_WIDTH_MAX,
    defaultWidth: SIDEBAR_WIDTH_DEFAULT,
    load: loadSidebarPrefs,
    save: saveSidebarPrefs,
    decode: decodeSidebarPrefs,
    onLoadError: logSidebarPrefsError
  })

  return (
    <SidebarProvider
      open={isOpen()}
      onOpenChange={setOpen}
      className="!min-h-0 h-full"
      style={{ '--sidebar-width': `${width()}px` }}
    >
      <AppSidebar
        navigation={props.navigation}
        branchBrowser={props.branchBrowser}
        currentBranch={props.repo.branch}
        workingChanges={props.repo.changes}
        onResizeStart={(event) => onResizeStart(event.nativeEvent)}
      />
      <SidebarInset className="flex min-h-0 flex-col">
        <Topbar
          repoName={props.repo.repoName}
          repoPath={props.repo.repoPath}
          branch={props.repo.branch}
          onFetch={props.onFetch}
        />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t">
          {props.children}
        </div>
        <Statusbar
          branch={props.repo.branch}
          changes={props.repo.changes}
          directionLabel="History"
        />
      </SidebarInset>
    </SidebarProvider>
  )
}

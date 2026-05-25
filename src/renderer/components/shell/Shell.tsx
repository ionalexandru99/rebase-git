import { parseOrThrow } from '@shared/codec'
import { SidebarPrefsSchema } from '@shared/schemas/ipc'
import type { JSX } from 'solid-js'
import type { BranchTracking, RefKind } from '@/lib/ref-tree'
import { useDraggableWidth } from '../../hooks/useDraggableWidth'
import { SidebarInset, SidebarProvider } from '../ui/sidebar'
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
  branchFilterActive?: boolean
  selectedFilterRefs?: ReadonlySet<string>
  onSelectView: (view: SidebarView) => void
  onToggleBranchFilter?: () => void
  onToggleFilterRef?: (refKind: RefKind, fullPath: string) => void
  onFetch?: () => void
  onCheckoutRef?: (refKind: RefKind, fullPath: string) => void
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
      class="!min-h-0 h-full"
      style={{ '--sidebar-width': `${width()}px` }}
    >
      <AppSidebar
        localBranches={props.localBranches}
        remoteBranches={props.remoteBranches}
        tags={props.tags}
        currentBranch={props.branch}
        branchesLoading={props.branchesLoading}
        workingChanges={props.changes}
        activeView={props.activeView}
        tracking={props.tracking}
        branchFilterActive={props.branchFilterActive}
        selectedFilterRefs={props.selectedFilterRefs}
        onSelectView={props.onSelectView}
        onToggleBranchFilter={props.onToggleBranchFilter}
        onToggleFilterRef={props.onToggleFilterRef}
        onResizeStart={onResizeStart}
        onCheckoutRef={props.onCheckoutRef}
      />
      <SidebarInset class="flex min-h-0 flex-col">
        <Topbar
          repoName={props.repoName}
          repoPath={props.repoPath}
          branch={props.branch}
          onFetch={props.onFetch}
        />
        <div class="flex min-h-0 flex-1 flex-col overflow-hidden border-t">{props.children}</div>
        <Statusbar branch={props.branch} changes={props.changes} directionLabel="History" />
      </SidebarInset>
    </SidebarProvider>
  )
}

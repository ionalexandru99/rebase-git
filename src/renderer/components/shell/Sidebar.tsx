import { FileDiff, History } from 'lucide-react'
import {
  Sidebar as ShadSidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem
} from '@/components/ui/sidebar'
import type { BranchTracking, RefKind } from '@/lib/ref-tree'
import { RefTreePanel } from './RefTreePanel'

export type SidebarView = 'history' | 'local-changes'

interface AppSidebarProps {
  localBranches: string[]
  remoteBranches: string[]
  tags: string[]
  currentBranch: string
  branchesLoading?: boolean
  workingChanges: number
  activeView: SidebarView
  tracking?: Record<string, BranchTracking>
  onSelectView: (view: SidebarView) => void
  onResizeStart?: (e: React.MouseEvent) => void
  onCheckoutRef?: (refKind: RefKind, fullPath: string) => void
}

export function AppSidebar({
  localBranches,
  remoteBranches,
  tags,
  currentBranch,
  branchesLoading,
  workingChanges,
  activeView,
  tracking,
  onSelectView,
  onResizeStart,
  onCheckoutRef
}: AppSidebarProps) {
  return (
    <ShadSidebar className="!top-10 !h-[calc(100svh-2.5rem)]">
      {onResizeStart && (
        <span
          onMouseDown={onResizeStart}
          aria-hidden
          className="group/sidebar-resize absolute -right-1 top-0 z-30 flex h-full w-2 cursor-col-resize items-stretch justify-center"
        >
          <span className="w-px bg-transparent transition-colors group-hover/sidebar-resize:bg-primary/60" />
        </span>
      )}

      <SidebarContent className="!overflow-hidden">
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={activeView === 'local-changes'}
                onClick={() => onSelectView('local-changes')}
              >
                <FileDiff />
                <span>Local changes</span>
              </SidebarMenuButton>
              {workingChanges > 0 && <SidebarMenuBadge>{workingChanges}</SidebarMenuBadge>}
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={activeView === 'history'}
                onClick={() => onSelectView('history')}
              >
                <History />
                <span>History</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        <RefTreePanel
          localBranches={localBranches}
          remoteBranches={remoteBranches}
          tags={tags}
          currentBranch={currentBranch}
          loading={branchesLoading}
          tracking={tracking}
          onCheckoutRef={onCheckoutRef}
        />
      </SidebarContent>
    </ShadSidebar>
  )
}

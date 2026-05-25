import { FileDiffIcon, HistoryIcon } from 'lucide-solid'
import { Show } from 'solid-js'
import type { BranchTracking, RefKind } from '@/lib/ref-tree'
import {
  Sidebar as ShadSidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem
} from '../ui/sidebar'
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
  onResizeStart?: (event: MouseEvent) => void
  onCheckoutRef?: (refKind: RefKind, fullPath: string) => void
}

export function AppSidebar(props: AppSidebarProps) {
  return (
    <ShadSidebar class="!top-10 !h-[calc(100svh-2.5rem)]">
      <Show when={props.onResizeStart}>
        <span
          onMouseDown={(event) => props.onResizeStart?.(event)}
          aria-hidden="true"
          class="group/sidebar-resize absolute -right-1 top-0 z-30 flex h-full w-2 cursor-col-resize items-stretch justify-center"
        >
          <span class="w-px bg-transparent transition-colors group-hover/sidebar-resize:bg-primary/60" />
        </span>
      </Show>

      <SidebarContent class="!overflow-hidden">
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={props.activeView === 'local-changes'}
                onClick={() => props.onSelectView('local-changes')}
              >
                <FileDiffIcon />
                <span>Local changes</span>
              </SidebarMenuButton>
              <Show when={props.workingChanges > 0}>
                <SidebarMenuBadge>{props.workingChanges}</SidebarMenuBadge>
              </Show>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={props.activeView === 'history'}
                onClick={() => props.onSelectView('history')}
              >
                <HistoryIcon />
                <span>History</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        <RefTreePanel
          localBranches={props.localBranches}
          remoteBranches={props.remoteBranches}
          tags={props.tags}
          currentBranch={props.currentBranch}
          loading={props.branchesLoading}
          tracking={props.tracking}
          onCheckoutRef={props.onCheckoutRef}
        />
      </SidebarContent>
    </ShadSidebar>
  )
}

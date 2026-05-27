import { FileDiffIcon, HistoryIcon } from 'lucide-react'
import type { MouseEvent } from 'react'
import { Show } from '@/lib/react-compat'
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
  visibleTimelineRefs?: ReadonlySet<string>
  onSelectView: (view: SidebarView) => void
  onToggleTimelineVisibility?: (refKind: RefKind, fullPath: string) => void
  onResizeStart?: (event: MouseEvent<HTMLSpanElement>) => void
  onCheckoutRef?: (refKind: RefKind, fullPath: string) => void
}

export function AppSidebar(props: AppSidebarProps) {
  return (
    <ShadSidebar className="!top-10 !h-[calc(100svh-2.5rem)]">
      <Show when={props.onResizeStart}>
        <span
          onMouseDown={(event) => props.onResizeStart?.(event)}
          aria-hidden="true"
          className="group/sidebar-resize absolute -right-1 top-0 z-30 flex h-full w-2 cursor-col-resize items-stretch justify-center"
        >
          <span className="w-px bg-transparent transition-colors group-hover/sidebar-resize:bg-primary/60" />
        </span>
      </Show>

      <SidebarContent className="!overflow-hidden">
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

        <SidebarGroup className="min-h-0 flex-1 !overflow-hidden">
          <SidebarGroupLabel className="px-2 pb-1">Branches</SidebarGroupLabel>

          <RefTreePanel
            localBranches={props.localBranches}
            remoteBranches={props.remoteBranches}
            tags={props.tags}
            currentBranch={props.currentBranch}
            loading={props.branchesLoading}
            tracking={props.tracking}
            visibleTimelineRefs={props.visibleTimelineRefs}
            onToggleTimelineVisibility={props.onToggleTimelineVisibility}
            onCheckoutRef={props.onCheckoutRef}
          />
        </SidebarGroup>
      </SidebarContent>
    </ShadSidebar>
  )
}

import { FileDiffIcon, HistoryIcon } from 'lucide-react'
import type { MouseEvent } from 'react'
import { Dynamic, Show } from '@/lib/react-compat'
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
import type { BranchBrowser, WorkspaceNavigation } from './Shell'

const workspaceNavItems = [
  { view: 'local-changes', label: 'Local changes', icon: FileDiffIcon, badge: 'workingChanges' },
  { view: 'history', label: 'History', icon: HistoryIcon }
] as const

export type SidebarView = (typeof workspaceNavItems)[number]['view']

interface AppSidebarProps {
  navigation: WorkspaceNavigation
  branchBrowser: BranchBrowser
  currentBranch: string
  workingChanges: number
  onResizeStart?: (event: MouseEvent<HTMLSpanElement>) => void
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
            {workspaceNavItems.map((item) => {
              const badge =
                'badge' in item && item.badge === 'workingChanges' ? props.workingChanges : 0
              return (
                <SidebarMenuItem key={item.view}>
                  <SidebarMenuButton
                    isActive={props.navigation.activeView === item.view}
                    onClick={() => props.navigation.onSelectView(item.view)}
                  >
                    <Dynamic component={item.icon} />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                  <Show when={badge > 0}>
                    <SidebarMenuBadge>{badge}</SidebarMenuBadge>
                  </Show>
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup className="min-h-0 flex-1 !overflow-hidden">
          <SidebarGroupLabel className="px-2 pb-1">Branches</SidebarGroupLabel>

          <RefTreePanel
            localBranches={props.branchBrowser.localBranches}
            remoteBranches={props.branchBrowser.remoteBranches}
            tags={props.branchBrowser.tags}
            currentBranch={props.currentBranch}
            loading={props.branchBrowser.branchesLoading}
            tracking={props.branchBrowser.tracking}
            visibleTimelineRefs={props.branchBrowser.visibleTimelineRefs}
            onToggleTimelineVisibility={props.branchBrowser.onToggleTimelineVisibility}
            onCheckoutRef={props.branchBrowser.onCheckoutRef}
          />
        </SidebarGroup>
      </SidebarContent>
    </ShadSidebar>
  )
}

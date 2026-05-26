import { FileDiffIcon, HistoryIcon, ListFilterIcon } from 'lucide-solid'
import { Show } from 'solid-js'
import type { BranchTracking, RefKind } from '@/lib/ref-tree'
import { Button } from '../ui/button'
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
  branchFilterActive?: boolean
  selectedFilterRefs?: ReadonlySet<string>
  onSelectView: (view: SidebarView) => void
  onToggleBranchFilter?: () => void
  onToggleFilterRef?: (refKind: RefKind, fullPath: string) => void
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

        <SidebarGroup class="min-h-0 flex-1 !overflow-hidden">
          <div class="flex items-center justify-between px-2 pb-1">
            <SidebarGroupLabel class="mb-0">Branches</SidebarGroupLabel>
            <div class="relative">
              <Button
                type="button"
                variant={props.branchFilterActive ? 'secondary' : 'ghost'}
                size="icon-xs"
                title="Filter timeline by branch"
                aria-pressed={props.branchFilterActive}
                data-testid="branch-filter-toggle"
                onClick={() => props.onToggleBranchFilter?.()}
              >
                <ListFilterIcon />
              </Button>
              <Show when={(props.selectedFilterRefs?.size ?? 0) > 0}>
                <span
                  data-testid="branch-filter-count"
                  class="pointer-events-none absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground"
                >
                  {props.selectedFilterRefs?.size}
                </span>
              </Show>
            </div>
          </div>

          <RefTreePanel
            localBranches={props.localBranches}
            remoteBranches={props.remoteBranches}
            tags={props.tags}
            currentBranch={props.currentBranch}
            loading={props.branchesLoading}
            tracking={props.tracking}
            filterActive={props.branchFilterActive}
            selectedFilterRefs={props.selectedFilterRefs}
            onToggleFilterRef={props.onToggleFilterRef}
            onCheckoutRef={props.onCheckoutRef}
          />
        </SidebarGroup>
      </SidebarContent>
    </ShadSidebar>
  )
}

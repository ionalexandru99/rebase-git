import { ArrowDown, ArrowUp, FileDiff, GitBranch, History } from 'lucide-react'
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

interface SidebarBranch {
  name: string
  current: boolean
  ahead?: number
  behind?: number
}

export type SidebarView = 'history' | 'local-changes'

interface AppSidebarProps {
  branches: SidebarBranch[]
  workingChanges: number
  activeBranch: string
  activeView: SidebarView
  onSelectView: (view: SidebarView) => void
  onSelectBranch: (name: string) => void
}

export function AppSidebar({
  branches,
  workingChanges,
  activeBranch,
  activeView,
  onSelectView,
  onSelectBranch
}: AppSidebarProps) {
  return (
    <ShadSidebar className="!top-10 !h-[calc(100svh-2.5rem)]">
      <SidebarContent>
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

        <SidebarGroup>
          <SidebarGroupLabel>Branches</SidebarGroupLabel>
          <SidebarMenu>
            {branches.map((b) => (
              <SidebarMenuItem key={b.name}>
                <SidebarMenuButton
                  isActive={b.name === activeBranch}
                  onClick={() => onSelectBranch(b.name)}
                >
                  <GitBranch />
                  <span className="truncate">{b.name}</span>
                  {(b.ahead ?? 0) > 0 && (
                    <span className="ml-auto inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                      <ArrowUp className="size-3" />
                      {b.ahead}
                    </span>
                  )}
                  {(b.behind ?? 0) > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                      <ArrowDown className="size-3" />
                      {b.behind}
                    </span>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
    </ShadSidebar>
  )
}

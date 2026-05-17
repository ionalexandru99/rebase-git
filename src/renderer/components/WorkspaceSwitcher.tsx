import { Check, ChevronsUpDown, FolderOpen, FolderPlus, Trash2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

interface WorkspaceSwitcherProps {
  workspaces: string[]
  activeWorkspace: string | null
  onSwitch: (path: string) => void
  onAdd: () => void
  onRemove: (path: string) => void
}

function shortName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path
}

export function WorkspaceSwitcher({
  workspaces,
  activeWorkspace,
  onSwitch,
  onAdd,
  onRemove
}: WorkspaceSwitcherProps) {
  const canRemove = workspaces.length > 1 && !!activeWorkspace

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Switch workspace"
        className="group flex h-8 w-full items-center gap-2 rounded-md border border-border bg-card px-2.5 text-left text-sm text-foreground/85 hover:bg-accent hover:text-foreground focus-visible:border-primary/40 focus-visible:outline-none"
      >
        <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
        <span className="min-w-0 flex-1 truncate font-medium">
          {activeWorkspace ? shortName(activeWorkspace) : 'No workspace'}
        </span>
        {activeWorkspace && (
          <span className="truncate text-xs text-muted-foreground/60">{activeWorkspace}</span>
        )}
        <ChevronsUpDown
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60 group-hover:text-muted-foreground"
          strokeWidth={2}
        />
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        className="min-w-[var(--radix-dropdown-menu-trigger-width)] border-border bg-popover text-sm"
      >
        {workspaces.length > 0 && (
          <>
            <DropdownMenuLabel className="px-2 py-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Workspaces
            </DropdownMenuLabel>
            {workspaces.map((ws) => {
              const isActive = ws === activeWorkspace
              return (
                <DropdownMenuItem
                  key={ws}
                  onSelect={() => onSwitch(ws)}
                  className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm"
                >
                  <Check
                    className={`h-3.5 w-3.5 shrink-0 ${isActive ? 'text-primary' : 'text-transparent'}`}
                    strokeWidth={2.5}
                  />
                  <div className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="truncate font-medium text-foreground">{shortName(ws)}</span>
                    <span className="truncate text-xs text-muted-foreground/70">{ws}</span>
                  </div>
                </DropdownMenuItem>
              )
            })}
            <DropdownMenuSeparator className="bg-border/70" />
          </>
        )}

        <DropdownMenuItem
          onSelect={onAdd}
          className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm text-foreground/85"
        >
          <FolderPlus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
          <span>Add workspace…</span>
        </DropdownMenuItem>

        {canRemove && activeWorkspace && (
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => onRemove(activeWorkspace)}
            className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm"
          >
            <Trash2 className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
            <span className="truncate">Remove “{shortName(activeWorkspace)}”</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

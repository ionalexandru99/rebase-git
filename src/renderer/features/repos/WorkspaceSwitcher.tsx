import {
  CheckIcon,
  ChevronsUpDownIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  Trash2Icon
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '../../components/ui/dropdown-menu'

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

export function WorkspaceSwitcher(props: WorkspaceSwitcherProps) {
  const activeWorkspace = props.activeWorkspace
  const canRemove = props.workspaces.length > 1 && !!activeWorkspace

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Switch workspace"
        className="group flex h-8 w-full items-center gap-2 rounded-md border border-border bg-card px-2.5 text-left text-sm text-foreground/85 hover:bg-accent hover:text-foreground focus-visible:border-primary/40 focus-visible:outline-none"
      >
        <FolderOpenIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
        <span className="min-w-0 flex-1 truncate font-medium">
          {activeWorkspace ? shortName(activeWorkspace) : 'No workspace'}
        </span>
        {activeWorkspace && (
          <span className="truncate text-xs text-muted-foreground/60">{activeWorkspace}</span>
        )}
        <ChevronsUpDownIcon
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60 group-hover:text-muted-foreground"
          strokeWidth={2}
        />
      </DropdownMenuTrigger>

      <DropdownMenuContent className="w-[18rem] max-w-[80vw] border-border bg-popover text-sm">
        {props.workspaces.length > 0 && (
          <>
            <DropdownMenuLabel className="px-2 py-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Workspaces
            </DropdownMenuLabel>
            {props.workspaces.map((workspace) => {
              const isActive = workspace === activeWorkspace
              return (
                <DropdownMenuItem
                  key={workspace}
                  onSelect={() => props.onSwitch(workspace)}
                  className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm"
                >
                  <CheckIcon
                    className={`h-3.5 w-3.5 shrink-0 ${isActive ? 'text-primary' : 'text-transparent'}`}
                    strokeWidth={2.5}
                  />
                  <div className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="truncate font-medium text-foreground">
                      {shortName(workspace)}
                    </span>
                    <span className="truncate text-xs text-muted-foreground/70">{workspace}</span>
                  </div>
                </DropdownMenuItem>
              )
            })}
            <DropdownMenuSeparator className="bg-border/70" />
          </>
        )}

        <DropdownMenuItem
          onSelect={() => props.onAdd()}
          className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm text-foreground/85"
        >
          <FolderPlusIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
          <span>Add workspace…</span>
        </DropdownMenuItem>

        {canRemove && activeWorkspace && (
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => props.onRemove(activeWorkspace)}
            className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm"
          >
            <Trash2Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
            <span className="truncate">Remove “{shortName(activeWorkspace)}”</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

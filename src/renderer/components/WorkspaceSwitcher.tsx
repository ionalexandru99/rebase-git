import {
  CheckIcon,
  ChevronsUpDownIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  Trash2Icon
} from 'lucide-react'
import { For, Show } from '@/lib/react-compat'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from './ui/dropdown-menu'

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
  const canRemove = () => props.workspaces.length > 1 && !!props.activeWorkspace

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Switch workspace"
        className="group flex h-8 w-full items-center gap-2 rounded-md border border-border bg-card px-2.5 text-left text-sm text-foreground/85 hover:bg-accent hover:text-foreground focus-visible:border-primary/40 focus-visible:outline-none"
      >
        <FolderOpenIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
        <span className="min-w-0 flex-1 truncate font-medium">
          {props.activeWorkspace ? shortName(props.activeWorkspace) : 'No workspace'}
        </span>
        <Show when={props.activeWorkspace}>
          {(active) => (
            <span className="truncate text-xs text-muted-foreground/60">{active()}</span>
          )}
        </Show>
        <ChevronsUpDownIcon
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60 group-hover:text-muted-foreground"
          strokeWidth={2}
        />
      </DropdownMenuTrigger>

      <DropdownMenuContent className="min-w-[var(--kb-popper-anchor-width)] border-border bg-popover text-sm">
        <Show when={props.workspaces.length > 0}>
          <DropdownMenuLabel className="px-2 py-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Workspaces
          </DropdownMenuLabel>
          <For each={props.workspaces}>
            {(workspace) => {
              const isActive = () => workspace === props.activeWorkspace
              return (
                <DropdownMenuItem
                  onSelect={() => props.onSwitch(workspace)}
                  className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm"
                >
                  <CheckIcon
                    className={`h-3.5 w-3.5 shrink-0 ${isActive() ? 'text-primary' : 'text-transparent'}`}
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
            }}
          </For>
          <DropdownMenuSeparator className="bg-border/70" />
        </Show>

        <DropdownMenuItem
          onSelect={() => props.onAdd()}
          className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm text-foreground/85"
        >
          <FolderPlusIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
          <span>Add workspace…</span>
        </DropdownMenuItem>

        <Show when={canRemove() && props.activeWorkspace}>
          {(active) => (
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => props.onRemove(active())}
              className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm"
            >
              <Trash2Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              <span className="truncate">Remove “{shortName(active())}”</span>
            </DropdownMenuItem>
          )}
        </Show>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

import {
  CheckIcon,
  ChevronsUpDownIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  Trash2Icon
} from 'lucide-solid'
import { For, Show } from 'solid-js'
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
        class="group flex h-8 w-full items-center gap-2 rounded-md border border-border bg-card px-2.5 text-left text-sm text-foreground/85 hover:bg-accent hover:text-foreground focus-visible:border-primary/40 focus-visible:outline-none"
      >
        <FolderOpenIcon class="h-3.5 w-3.5 shrink-0 text-muted-foreground" stroke-width={2} />
        <span class="min-w-0 flex-1 truncate font-medium">
          {props.activeWorkspace ? shortName(props.activeWorkspace) : 'No workspace'}
        </span>
        <Show when={props.activeWorkspace}>
          {(active) => <span class="truncate text-xs text-muted-foreground/60">{active()}</span>}
        </Show>
        <ChevronsUpDownIcon
          class="h-3.5 w-3.5 shrink-0 text-muted-foreground/60 group-hover:text-muted-foreground"
          stroke-width={2}
        />
      </DropdownMenuTrigger>

      <DropdownMenuContent class="min-w-[var(--kb-popper-anchor-width)] border-border bg-popover text-sm">
        <Show when={props.workspaces.length > 0}>
          <DropdownMenuLabel class="px-2 py-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Workspaces
          </DropdownMenuLabel>
          <For each={props.workspaces}>
            {(workspace) => {
              const isActive = () => workspace === props.activeWorkspace
              return (
                <DropdownMenuItem
                  onSelect={() => props.onSwitch(workspace)}
                  class="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm"
                >
                  <CheckIcon
                    class={`h-3.5 w-3.5 shrink-0 ${isActive() ? 'text-primary' : 'text-transparent'}`}
                    stroke-width={2.5}
                  />
                  <div class="flex min-w-0 flex-1 flex-col leading-tight">
                    <span class="truncate font-medium text-foreground">{shortName(workspace)}</span>
                    <span class="truncate text-xs text-muted-foreground/70">{workspace}</span>
                  </div>
                </DropdownMenuItem>
              )
            }}
          </For>
          <DropdownMenuSeparator class="bg-border/70" />
        </Show>

        <DropdownMenuItem
          onSelect={() => props.onAdd()}
          class="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm text-foreground/85"
        >
          <FolderPlusIcon class="h-3.5 w-3.5 shrink-0 text-muted-foreground" stroke-width={2} />
          <span>Add workspace…</span>
        </DropdownMenuItem>

        <Show when={canRemove() && props.activeWorkspace}>
          {(active) => (
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => props.onRemove(active())}
              class="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm"
            >
              <Trash2Icon class="h-3.5 w-3.5 shrink-0" stroke-width={2} />
              <span class="truncate">Remove “{shortName(active())}”</span>
            </DropdownMenuItem>
          )}
        </Show>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

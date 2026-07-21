import { Archive, ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../ui/dropdown-menu'

interface StashControlProps {
  stagedFiles: string[]
  stagedCount: number
  hasChanges: boolean
  busy: boolean
  onStashSelected: (files: string[]) => void
  onStashAll: () => void
}

export function StashControl(props: StashControlProps) {
  const canStashSelected = props.stagedCount > 0 && !props.busy

  const stashSelected = () => props.onStashSelected(props.stagedFiles)

  return (
    <div className="flex h-7 shrink-0 items-stretch overflow-hidden rounded-[var(--r-sm)] border bg-card-2 text-xs text-muted-foreground">
      <button
        type="button"
        disabled={!canStashSelected}
        onClick={stashSelected}
        title={
          canStashSelected
            ? 'Stash the staged files'
            : 'Stage files to stash a selection, or use the menu to stash everything'
        }
        className="flex items-center gap-1 px-2.5 transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Archive className="size-3.5" />
        Stash
        {props.stagedCount > 0 ? (
          <span className="rounded-full bg-muted px-1.5 text-[10px]">{props.stagedCount}</span>
        ) : null}
      </button>
      <DropdownMenu className="flex">
        <DropdownMenuTrigger
          aria-label="More stash options"
          className="flex items-center border-l px-1 transition-colors hover:border-border-strong hover:text-foreground"
        >
          <ChevronDown className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent portal>
          <DropdownMenuItem disabled={!props.hasChanges || props.busy} onSelect={props.onStashAll}>
            Stash all changes
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

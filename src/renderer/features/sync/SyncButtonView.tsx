import { ChevronDownIcon, Loader2Icon } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../../components/ui/dropdown-menu'

export interface SyncButtonViewProps {
  ahead: number
  behind: number
  detached: boolean
  syncing: boolean
  disabled?: boolean
  onSync: () => void
  onForcePush: () => void
  dialogs?: ReactNode
}

const primaryButtonClass =
  'inline-flex h-6 shrink-0 items-center gap-1 rounded-l-[var(--r-sm)] bg-muted px-2 text-xs transition-colors hover:bg-border-strong disabled:cursor-default disabled:opacity-50'
const caretButtonClass =
  'inline-flex h-6 shrink-0 items-center rounded-r-[var(--r-sm)] border-l border-border bg-muted px-0.5 transition-colors hover:bg-border-strong disabled:cursor-default disabled:opacity-50'

export function SyncButtonView(props: SyncButtonViewProps) {
  const disabled = props.disabled || props.syncing

  return (
    <>
      <DropdownMenu className="inline-flex">
        <button
          type="button"
          data-testid="sync-button"
          onClick={props.onSync}
          disabled={disabled}
          className={primaryButtonClass}
        >
          {props.syncing ? <Loader2Icon className="size-3 animate-spin" /> : null}
          Sync
          {props.behind > 0 ? (
            <span className="tabular-nums text-muted-foreground">↓{props.behind}</span>
          ) : null}
          {props.ahead > 0 ? (
            <span className="tabular-nums text-muted-foreground">↑{props.ahead}</span>
          ) : null}
        </button>
        <DropdownMenuTrigger
          aria-label="Sync options"
          disabled={disabled}
          className={caretButtonClass}
        >
          <ChevronDownIcon className="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="rounded-[var(--r-sm)] shadow-lg">
          <DropdownMenuItem
            disabled={props.detached}
            onSelect={props.onForcePush}
            className="whitespace-nowrap rounded-[var(--r-xs)] px-2.5 transition-colors hover:bg-muted disabled:cursor-default disabled:hover:bg-transparent"
          >
            Force push (with lease)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {props.dialogs}
    </>
  )
}

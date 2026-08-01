import { ChevronDownIcon, Loader2Icon } from 'lucide-react'
import type { PushForce } from '@/lib/rpc-client'
import type { PushOutcome } from '@/stores/action-runner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../../components/ui/dropdown-menu'
import { usePushFlow } from './usePushFlow'

interface SyncButtonProps {
  branchName: string
  ahead: number
  behind: number
  detached: boolean
  syncing: boolean
  disabled?: boolean
  onPull: () => Promise<boolean> | boolean
  onFetch: () => void
  push: (force?: PushForce, expectedRemoteSha?: string) => Promise<PushOutcome>
}

const primaryButtonClass =
  'inline-flex h-6 shrink-0 items-center gap-1 rounded-l-[var(--r-sm)] bg-muted px-2 text-xs transition-colors hover:bg-border-strong disabled:cursor-default disabled:opacity-50'
const caretButtonClass =
  'inline-flex h-6 shrink-0 items-center rounded-r-[var(--r-sm)] border-l border-border bg-muted px-0.5 transition-colors hover:bg-border-strong disabled:cursor-default disabled:opacity-50'

export function SyncButton(props: SyncButtonProps) {
  const pushFlow = usePushFlow({
    branchName: props.branchName,
    ahead: props.ahead,
    behind: props.behind,
    push: props.push
  })

  const sync = async () => {
    if (props.behind === 0 && props.ahead === 0) {
      props.onFetch()
      return
    }
    if (props.behind > 0 && (await props.onPull()) === false) {
      return
    }
    if (props.ahead > 0) {
      await pushFlow.requestPush()
    }
  }

  return (
    <>
      <DropdownMenu className="inline-flex">
        <button
          type="button"
          data-testid="sync-button"
          onClick={() => void sync()}
          disabled={props.disabled || props.syncing}
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
          disabled={props.disabled || props.syncing}
          className={caretButtonClass}
        >
          <ChevronDownIcon className="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="rounded-[var(--r-sm)] shadow-lg">
          <DropdownMenuItem
            disabled={props.detached}
            onSelect={pushFlow.openForceConfirm}
            className="whitespace-nowrap rounded-[var(--r-xs)] px-2.5 transition-colors hover:bg-muted disabled:cursor-default disabled:hover:bg-transparent"
          >
            Force push (with lease)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {pushFlow.dialogs}
    </>
  )
}

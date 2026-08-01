import { CommandIcon, MoreHorizontalIcon, SearchIcon, XIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { commitCountLabel } from '@/features/history/commit-count'
import { SyncButton } from '@/features/sync/SyncButton'
import type { PushForce } from '@/lib/rpc-client'
import type { PushOutcome } from '@/stores/action-runner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../components/ui/dropdown-menu'
import { Input } from '../components/ui/input'
import { LoadingBadge } from '../components/ui/loading-badge'

interface ListColumnHeaderProps {
  repoName: string
  loadedCount: number
  visibleTotal: number
  visibleBranchCount: number
  hasMore?: boolean
  loading?: boolean
  filter: string
  onFilterChange: (value: string) => void
  branchName: string
  ahead: number
  behind: number
  detached: boolean
  syncing: boolean
  busy?: boolean
  onFetch: () => void
  onPull: () => Promise<boolean> | boolean
  push: (force?: PushForce, expectedRemoteSha?: string) => Promise<PushOutcome>
  onResetLayout: () => void
  onCopyRepoPath: () => void
}

const iconButtonClass =
  'inline-flex size-6 shrink-0 items-center justify-center rounded-[var(--r-sm)] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent'
const actionButtonClass =
  'inline-flex h-6 shrink-0 items-center rounded-[var(--r-sm)] bg-muted px-2 text-xs transition-colors hover:bg-border-strong disabled:cursor-default disabled:opacity-50'

export function ListColumnHeader(props: ListColumnHeaderProps) {
  const [filterOpen, setFilterOpen] = useState(false)
  const filterInput = useRef<HTMLInputElement>(null)
  const showFilter = filterOpen || props.filter.length > 0

  useEffect(() => {
    if (filterOpen) {
      filterInput.current?.focus()
    }
  }, [filterOpen])

  const closeFilter = () => {
    setFilterOpen(false)
    props.onFilterChange('')
  }

  return (
    <>
      <div className="flex min-w-0 flex-col justify-center pl-2">
        <span className="truncate text-[13px] font-semibold leading-tight">{props.repoName}</span>
        <span className="truncate text-[11px] leading-tight text-muted-foreground">
          {commitCountLabel({
            loadedCount: props.loadedCount,
            visibleTotal: props.visibleTotal,
            visibleBranchCount: props.visibleBranchCount,
            hasMore: props.hasMore
          })}
        </span>
      </div>

      <div className="flex-1" />

      {props.loading ? <LoadingBadge /> : null}

      {showFilter ? (
        <span className="flex shrink-0 items-center gap-0.5">
          <Input
            ref={filterInput}
            value={props.filter}
            onChange={(event) => props.onFilterChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation()
                closeFilter()
              }
            }}
            placeholder="Filter commits…"
            aria-label="Filter commits"
            className="h-6 w-36 rounded-[var(--r-sm)] bg-background text-xs"
          />
          <button
            type="button"
            aria-label="Clear commit filter"
            onClick={closeFilter}
            className={iconButtonClass}
          >
            <XIcon className="size-3.5" />
          </button>
        </span>
      ) : (
        <button
          type="button"
          aria-label="Filter commits"
          title="Filter commits"
          onClick={() => setFilterOpen(true)}
          className={iconButtonClass}
        >
          <SearchIcon className="size-3.5" />
        </button>
      )}

      <button
        type="button"
        onClick={props.onFetch}
        disabled={props.busy}
        className={actionButtonClass}
      >
        Fetch
      </button>

      <SyncButton
        branchName={props.branchName}
        ahead={props.ahead}
        behind={props.behind}
        detached={props.detached}
        syncing={props.syncing}
        disabled={props.busy}
        onPull={props.onPull}
        onFetch={props.onFetch}
        push={props.push}
      />

      <button
        type="button"
        disabled
        aria-label="Command palette"
        title="Coming soon"
        className={iconButtonClass}
      >
        <CommandIcon className="size-3.5" />
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger aria-label="Repository actions" className={iconButtonClass}>
          <MoreHorizontalIcon className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent portal className="min-w-44">
          <DropdownMenuItem onSelect={props.onResetLayout}>Reset layout</DropdownMenuItem>
          <DropdownMenuItem onSelect={props.onCopyRepoPath}>Copy repo path</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}

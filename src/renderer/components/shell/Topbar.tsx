import { Loader2Icon, MenuIcon, MoreHorizontalIcon, PanelLeftIcon } from 'lucide-react'
import { type RefObject, useEffect, useRef, useState } from 'react'
import { formatRelativeTime } from '@/lib/format'
import type { PushForce } from '@/lib/rpc-client'
import { cn } from '@/lib/utils'
import type { PushOutcome } from '@/stores/action-runner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '../ui/dropdown-menu'
import { PushControl } from './PushControl'

export const workspaceViewTabs = [
  { view: 'history', label: 'History' },
  { view: 'local-changes', label: 'Local changes' }
] as const

export type WorkspaceView = (typeof workspaceViewTabs)[number]['view']

interface TopbarProps {
  repoName: string
  repoPath: string | null
  activeView: WorkspaceView
  onSelectView: (view: WorkspaceView) => void
  lastFetchedAt?: number | null
  onFetch?: () => void
  onPull?: () => void
  push?: (force?: PushForce, expectedRemoteSha?: string) => Promise<PushOutcome>
  branch?: string
  ahead?: number
  behind?: number
  detached?: boolean
  pulling?: boolean
  pushing?: boolean
  busy?: boolean
  compact?: boolean
  sidebarOpen?: boolean
  sidebarToggleRef?: RefObject<HTMLButtonElement | null>
  onToggleSidebar?: () => void
  onResetLayout?: () => void
}

const actionButtonClass =
  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--r-sm)] bg-muted px-2.5 transition-colors hover:bg-border-strong disabled:cursor-default disabled:opacity-50'

const COPY_FEEDBACK_MS = 1100

export function Topbar(props: TopbarProps) {
  const [copied, setCopied] = useState(false)
  const [relativeTimeNow, setRelativeTimeNow] = useState(Date.now())
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (copyTimer.current !== null) {
        clearTimeout(copyTimer.current)
      }
    }
  }, [])

  useEffect(() => {
    const fetchedAt = props.lastFetchedAt
    if (!fetchedAt) {
      return
    }
    const update = () => setRelativeTimeNow(Date.now())
    update()
    const elapsed = Math.max(0, Date.now() - fetchedAt)
    const delay = 60_000 - (elapsed % 60_000)
    let interval: ReturnType<typeof setInterval> | null = null
    const timeout = setTimeout(() => {
      update()
      interval = setInterval(update, 60_000)
    }, delay)
    return () => {
      clearTimeout(timeout)
      if (interval !== null) {
        clearInterval(interval)
      }
    }
  }, [props.lastFetchedAt])

  const copyPath = () => {
    const path = props.repoPath
    if (!path) {
      return
    }
    void navigator.clipboard?.writeText(path)
    setCopied(true)
    if (copyTimer.current !== null) {
      clearTimeout(copyTimer.current)
    }
    copyTimer.current = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS)
  }

  const hasRemoteActions = Boolean(props.onFetch || props.onPull)
  const hasRepositoryActions = hasRemoteActions || Boolean(props.onResetLayout)

  return (
    <div className="grid shrink-0 grid-rows-[40px_40px] border-b p-1">
      <div className="flex min-w-0 items-center gap-2.5 px-2">
        {props.onToggleSidebar ? (
          <button
            ref={props.sidebarToggleRef}
            type="button"
            aria-label={props.sidebarOpen ? 'Hide branches' : 'Show branches'}
            title={props.sidebarOpen ? 'Hide branches' : 'Show branches'}
            onClick={props.onToggleSidebar}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-[var(--r-sm)] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <PanelLeftIcon className="size-4" />
          </button>
        ) : null}
        <span className="shrink-0 font-semibold">{props.repoName}</span>
        {props.repoPath ? (
          <button
            type="button"
            title="Copy path"
            onClick={copyPath}
            className={cn(
              'min-w-0 truncate rounded-[var(--r-xs)] px-1 py-0.5 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
              copied && 'text-green hover:text-green'
            )}
          >
            {copied ? 'Copied path' : props.repoPath}
          </button>
        ) : null}
        <div className="flex-1" />
        {props.compact ? null : (
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => props.onFetch?.()}
              disabled={props.busy}
              className={actionButtonClass}
            >
              Fetch
            </button>
            <button
              type="button"
              onClick={() => props.onPull?.()}
              disabled={props.busy || props.pulling}
              className={actionButtonClass}
            >
              {props.pulling ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
              Pull
            </button>
          </div>
        )}
        {props.push ? (
          <PushControl
            branchName={props.branch ?? ''}
            ahead={props.ahead ?? 0}
            behind={props.behind ?? 0}
            detached={props.detached ?? false}
            pushing={props.pushing ?? false}
            disabled={props.busy}
            push={props.push}
          />
        ) : null}
        {hasRepositoryActions ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Repository actions"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-[var(--r-sm)] bg-muted transition-colors hover:bg-border-strong"
            >
              {props.compact ? (
                <MoreHorizontalIcon className="size-4" />
              ) : (
                <MenuIcon className="size-4" />
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent portal className="min-w-48">
              {props.onFetch ? (
                <DropdownMenuItem disabled={props.busy} onSelect={props.onFetch}>
                  Fetch from remotes
                </DropdownMenuItem>
              ) : null}
              {props.onPull ? (
                <DropdownMenuItem disabled={props.busy || props.pulling} onSelect={props.onPull}>
                  Pull from upstream
                </DropdownMenuItem>
              ) : null}
              {hasRemoteActions && props.onResetLayout ? <DropdownMenuSeparator /> : null}
              {props.onResetLayout ? (
                <DropdownMenuItem onSelect={props.onResetLayout}>Reset layout</DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <div className="flex min-w-0 items-center gap-2 px-2">
        <div className="flex items-center gap-1.5">
          {workspaceViewTabs.map((tab) => (
            <button
              key={tab.view}
              type="button"
              aria-pressed={props.activeView === tab.view}
              onClick={() => props.onSelectView(tab.view)}
              className={cn(
                'h-9 rounded-[var(--r-sm)] px-3 text-muted-foreground transition-colors',
                props.activeView === tab.view
                  ? 'bg-muted text-foreground'
                  : 'hover:bg-muted/60 hover:text-foreground'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {props.lastFetchedAt ? (
          <span className="min-w-0 truncate text-[13px] text-muted-foreground">
            Fetched {formatRelativeTime(props.lastFetchedAt, relativeTimeNow)}
          </span>
        ) : null}
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { summarizeWorkingCopy } from '@/features/history/working-copy-summary'
import { formatRelativeTime } from '@/lib/format'
import type { GitStatus } from '@/types'

interface StatusDockProps {
  branch: string | null
  ahead: number
  behind: number
  status: GitStatus | null | undefined
  lastFetchedAt?: number | null
}

function useTickingNow(lastFetchedAt: number | null | undefined): number {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!lastFetchedAt) {
      return
    }
    const update = () => setNow(Date.now())
    update()
    const elapsed = Math.max(0, Date.now() - lastFetchedAt)
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
  }, [lastFetchedAt])

  return now
}

export function StatusDock(props: StatusDockProps) {
  const now = useTickingNow(props.lastFetchedAt)
  const counts = summarizeWorkingCopy(props.status)
  const changed = counts.staged + counts.unstaged

  return (
    <div
      data-testid="status-dock"
      className="flex h-full min-w-0 items-center gap-3 px-3 text-[11px] text-muted-foreground"
    >
      <span className="shrink-0 font-medium text-foreground">{props.branch ?? 'detached'}</span>
      {props.behind > 0 ? <span className="shrink-0 tabular-nums">↓{props.behind}</span> : null}
      {props.ahead > 0 ? <span className="shrink-0 tabular-nums">↑{props.ahead}</span> : null}
      <span className="shrink-0 tabular-nums">
        {changed} changed · {counts.staged} staged
        {counts.conflicts > 0
          ? ` · ${counts.conflicts} conflict${counts.conflicts === 1 ? '' : 's'}`
          : ''}
      </span>
      <div className="flex-1" />
      {props.lastFetchedAt ? (
        <span className="min-w-0 shrink-0 truncate">
          Fetched {formatRelativeTime(props.lastFetchedAt, now)}
        </span>
      ) : null}
    </div>
  )
}

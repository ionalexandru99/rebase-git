import { ArrowDown, ArrowUp } from 'lucide-react'

interface StatusbarProps {
  branch: string
  ahead: number
  behind: number
  changes: number
  directionLabel: string
  lastFetch?: string
}

export function Statusbar({
  branch,
  ahead,
  behind,
  changes,
  directionLabel,
  lastFetch
}: StatusbarProps) {
  return (
    <div className="flex h-7 shrink-0 items-center gap-3 border-t bg-background px-3 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="size-1.5 rounded-full bg-primary" />
        {branch}
      </span>
      {ahead > 0 && (
        <span className="inline-flex items-center gap-1">
          <ArrowUp className="size-3" />
          {ahead} to push
        </span>
      )}
      {behind > 0 && (
        <span className="inline-flex items-center gap-1">
          <ArrowDown className="size-3" />
          {behind} to pull
        </span>
      )}
      <span>
        {changes} change{changes === 1 ? '' : 's'}
      </span>
      <span className="flex-1" />
      <span>
        Direction: <span className="text-foreground">{directionLabel}</span>
      </span>
      <span>·</span>
      <span>git</span>
      {lastFetch && (
        <>
          <span>·</span>
          <span>last fetch {lastFetch}</span>
        </>
      )}
    </div>
  )
}

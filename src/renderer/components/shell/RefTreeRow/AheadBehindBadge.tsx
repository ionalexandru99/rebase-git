import { ArrowDown, ArrowUp } from 'lucide-react'

interface AheadBehindBadgeProps {
  ahead?: number
  behind?: number
}

export function AheadBehindBadge({ ahead = 0, behind = 0 }: AheadBehindBadgeProps) {
  if (ahead === 0 && behind === 0) return null
  return (
    <>
      {ahead > 0 && (
        <span
          data-testid="ref-ahead"
          className="flex shrink-0 items-center gap-0.5 text-xs tabular-nums text-emerald-500"
          title={`${ahead} commit${ahead === 1 ? '' : 's'} to push`}
        >
          <ArrowUp className="size-3" />
          {ahead}
        </span>
      )}
      {behind > 0 && (
        <span
          data-testid="ref-behind"
          className="flex shrink-0 items-center gap-0.5 text-xs tabular-nums text-rose-500"
          title={`${behind} commit${behind === 1 ? '' : 's'} to pull`}
        >
          <ArrowDown className="size-3" />
          {behind}
        </span>
      )}
    </>
  )
}

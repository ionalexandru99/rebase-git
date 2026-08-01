import { cn } from '@/lib/utils'
import type { CommitStat } from './hooks/useCommitStats'
import { type HistoryListMode, WORKING_COPY_ROW_HEIGHT } from './list-modes'
import { type WorkingCopyCounts, workingCopySummaryText } from './working-copy-summary'

interface WorkingCopyRowProps {
  mode: HistoryListMode
  railWidth: number
  counts: WorkingCopyCounts
  stats?: CommitStat
  selected: boolean
  onSelect?: () => void
}

export function WorkingCopyRow(props: WorkingCopyRowProps) {
  const surface = props.selected ? 'bg-[var(--brand-soft)]' : 'bg-card group-hover/row:bg-muted'

  return (
    <div
      data-testid="working-copy-row"
      role="option"
      aria-selected={props.selected}
      tabIndex={0}
      onClick={() => props.onSelect?.()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          props.onSelect?.()
        }
      }}
      className="group/row absolute inset-x-0 top-0 z-10 select-none border-b"
      style={{ height: `${WORKING_COPY_ROW_HEIGHT}px`, contain: 'layout style' }}
    >
      <span className="sr-only">Working copy</span>
      {props.mode === 'index' ? null : (
        <div
          className={cn(
            'absolute inset-y-0 right-0 flex items-center gap-2 overflow-hidden pr-3',
            surface
          )}
          style={{ left: `${props.railWidth}px` }}
        >
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full bg-[var(--color-orange)]"
          />
          <span className="min-w-0 truncate text-sm text-[var(--color-orange)]">Working copy</span>
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {workingCopySummaryText(props.counts)}
          </span>
          <span
            data-testid="working-copy-churn"
            className="ml-auto flex shrink-0 items-center gap-1 text-xs tabular-nums"
          >
            {props.stats ? (
              <>
                <span className="text-add">{`+${props.stats.additions}`}</span>
                <span className="text-del">{`−${props.stats.deletions}`}</span>
              </>
            ) : null}
          </span>
        </div>
      )}
    </div>
  )
}

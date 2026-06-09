import { Show } from '@/lib/react-compat'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { LoadingBadge } from '../ui/loading-badge'

interface HistoryHeaderProps {
  total?: number
  visibleTotal?: number
  loading: boolean
  loadingMore?: boolean
  hasMore?: boolean
  onLoadMore?: () => void
  filter: string
  onFilterChange: (value: string) => void
  showFilter: boolean
  visibleBranchCount?: number
}

function subtitle(props: HistoryHeaderProps): string {
  const visible = props.visibleTotal ?? props.total
  if (!visible && !props.total) {
    return 'Repository timeline'
  }
  const count = visible ?? 0
  const commitLabel = `${count.toLocaleString()} commit${count === 1 ? '' : 's'}`
  const visibleBranchCount = props.visibleBranchCount ?? 0
  const filterLabel =
    visibleBranchCount === 0
      ? ' · no branches visible'
      : ` · ${visibleBranchCount} branch${visibleBranchCount === 1 ? '' : 'es'} visible`
  if (props.hasMore) {
    return `${commitLabel}${filterLabel} · more available`
  }
  return `${commitLabel}${filterLabel}`
}

export function HistoryHeader(props: HistoryHeaderProps) {
  return (
    <div className="flex min-h-[46px] shrink-0 items-center gap-2.5 border-b py-1.5 pl-3.5 pr-2">
      <div className="min-w-0">
        <div className="text-[15px] font-semibold">Timeline</div>
        <div className="truncate text-[13px] text-muted-foreground">{subtitle(props)}</div>
      </div>
      <div className="flex-1" />
      <Show when={props.loading || props.loadingMore}>
        <LoadingBadge />
      </Show>
      <Show when={props.hasMore && props.onLoadMore}>
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          disabled={props.loadingMore || props.loading}
          onClick={() => props.onLoadMore?.()}
        >
          {props.loadingMore ? 'Loading…' : 'Load more'}
        </Button>
      </Show>
      <Show when={props.showFilter}>
        <Input
          value={props.filter}
          onChange={(event) => props.onFilterChange(event.currentTarget.value)}
          placeholder="Filter commits…"
          aria-label="Filter commits"
          className="h-[34px] w-60 rounded-[var(--r-sm)] bg-background"
        />
      </Show>
    </div>
  )
}

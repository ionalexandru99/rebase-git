import { Show } from '@/lib/react-compat'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { LoadingBadge } from '../ui/loading-badge'
import { PanelActions, PanelHeader, PanelHeaderGroup, PanelSubtitle, PanelTitle } from '../ui/panel'

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
    <PanelHeader className="gap-3">
      <PanelHeaderGroup>
        <PanelTitle className="text-foreground">Timeline</PanelTitle>
        <PanelSubtitle>{subtitle(props)}</PanelSubtitle>
      </PanelHeaderGroup>

      <PanelActions>
        <Show when={props.hasMore && props.onLoadMore}>
          <Button
            size="sm"
            variant="outline"
            className="h-7"
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
            placeholder="filter commits…"
            className="h-7 w-40"
          />
        </Show>
        <Show when={props.loading || props.loadingMore}>
          <LoadingBadge />
        </Show>
      </PanelActions>
    </PanelHeader>
  )
}

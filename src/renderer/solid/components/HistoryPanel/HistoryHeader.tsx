import { Show } from 'solid-js'
import { Input } from '../ui/input'
import { LoadingBadge } from '../ui/loading-badge'
import { PanelActions, PanelHeader, PanelHeaderGroup, PanelSubtitle, PanelTitle } from '../ui/panel'

interface HistoryHeaderProps {
  total?: number
  loading: boolean
  filter: string
  onFilterChange: (value: string) => void
  showFilter: boolean
}

export function HistoryHeader(props: HistoryHeaderProps) {
  return (
    <PanelHeader class="gap-3">
      <PanelHeaderGroup>
        <PanelTitle class="text-foreground">Timeline</PanelTitle>
        <PanelSubtitle>
          {props.total
            ? `${props.total} commit${props.total === 1 ? '' : 's'} · all branches`
            : 'Repository timeline'}
        </PanelSubtitle>
      </PanelHeaderGroup>

      <PanelActions>
        <Show when={props.showFilter}>
          <Input
            value={props.filter}
            onInput={(event) => props.onFilterChange(event.currentTarget.value)}
            placeholder="filter commits…"
            class="h-7 w-40"
          />
        </Show>
        <Show when={props.loading}>
          <LoadingBadge />
        </Show>
      </PanelActions>
    </PanelHeader>
  )
}

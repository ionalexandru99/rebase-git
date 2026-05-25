import { Show } from 'solid-js'
import { Input } from '../ui/input'
import { LoadingBadge } from '../ui/loading-badge'
import { PanelActions, PanelHeader, PanelHeaderGroup, PanelSubtitle, PanelTitle } from '../ui/panel'

interface HistoryHeaderProps {
  total?: number
  visibleTotal?: number
  loading: boolean
  filter: string
  onFilterChange: (value: string) => void
  showFilter: boolean
  branchFilterActive?: boolean
  selectedBranchCount?: number
}

function subtitle(props: HistoryHeaderProps): string {
  const visible = props.visibleTotal ?? props.total
  if (!visible && !props.total) {
    return 'Repository timeline'
  }
  const count = visible ?? 0
  const commitLabel = `${count} commit${count === 1 ? '' : 's'}`
  if (props.branchFilterActive && (props.selectedBranchCount ?? 0) > 0) {
    return `${commitLabel} · filtered`
  }
  return `${commitLabel} · all branches`
}

export function HistoryHeader(props: HistoryHeaderProps) {
  return (
    <PanelHeader class="gap-3">
      <PanelHeaderGroup>
        <PanelTitle class="text-foreground">Timeline</PanelTitle>
        <PanelSubtitle>{subtitle(props)}</PanelSubtitle>
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

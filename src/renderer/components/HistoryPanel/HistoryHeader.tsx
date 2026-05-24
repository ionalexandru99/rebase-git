import { Input } from '@/components/ui/input'
import { LoadingBadge } from '@/components/ui/loading-badge'
import {
  PanelActions,
  PanelHeader,
  PanelHeaderGroup,
  PanelSubtitle,
  PanelTitle
} from '@/components/ui/panel'

interface HistoryHeaderProps {
  total?: number
  loading: boolean
  filter: string
  onFilterChange: (value: string) => void
  showFilter: boolean
}

export function HistoryHeader({
  total,
  loading,
  filter,
  onFilterChange,
  showFilter
}: HistoryHeaderProps) {
  return (
    <PanelHeader className="gap-3">
      <PanelHeaderGroup>
        <PanelTitle className="text-foreground">Timeline</PanelTitle>
        <PanelSubtitle>
          {total
            ? `${total} commit${total === 1 ? '' : 's'} · all branches`
            : 'Repository timeline'}
        </PanelSubtitle>
      </PanelHeaderGroup>

      <PanelActions>
        {showFilter && (
          <Input
            value={filter}
            onChange={(event) => onFilterChange(event.target.value)}
            placeholder="filter commits…"
            className="h-7 w-40"
          />
        )}
        {loading && <LoadingBadge />}
      </PanelActions>
    </PanelHeader>
  )
}

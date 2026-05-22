import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'

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
    <header className="flex h-9 shrink-0 items-center justify-between gap-3 border-b px-3">
      <div className="flex min-w-0 items-baseline gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground">Timeline</h2>
        <span className="truncate text-xs text-muted-foreground">
          {total
            ? `${total} commit${total === 1 ? '' : 's'} · all branches`
            : 'Repository timeline'}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {showFilter && (
          <Input
            value={filter}
            onChange={(event) => onFilterChange(event.target.value)}
            placeholder="filter commits…"
            className="h-7 w-40"
          />
        )}
        {loading && (
          <Badge
            variant="outline"
            className="gap-1 border-border bg-transparent font-normal text-muted-foreground"
          >
            <Loader2 className="animate-spin" />
            Loading
          </Badge>
        )}
      </div>
    </header>
  )
}

import { Skeleton } from '@/components/ui/skeleton'
import { type RefSectionRow, sectionKey } from '@/lib/ref-tree'
import { Chevron } from './Chevron'

interface SectionRowProps {
  row: RefSectionRow
  style: React.CSSProperties
  loading: boolean
  onToggleCollapsed: (key: string) => void
}

export function SectionRow({ row, style, loading, onToggleCollapsed }: SectionRowProps) {
  return (
    <button
      type="button"
      onClick={() => onToggleCollapsed(sectionKey(row.refKind))}
      className="absolute inset-x-0 flex items-center gap-1 px-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
      style={style}
    >
      <Chevron expanded={row.expanded} />
      <span>{row.label}</span>
      {loading ? (
        <Skeleton className="ml-auto h-2 w-4 rounded-sm" />
      ) : (
        <span className="ml-auto pr-1 tabular-nums opacity-60">{row.count}</span>
      )}
    </button>
  )
}

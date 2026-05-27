import { type JSX, Show } from '@/lib/react-compat'
import { type RefSectionRow, sectionKey } from '@/lib/ref-tree'
import { Skeleton } from '../../ui/skeleton'
import { Chevron } from './Chevron'

interface SectionRowProps {
  row: RefSectionRow
  style: JSX.CSSProperties
  loading: boolean
  onToggleCollapsed: (key: string) => void
}

export function SectionRow(props: SectionRowProps) {
  return (
    <button
      type="button"
      onClick={() => props.onToggleCollapsed(sectionKey(props.row.refKind))}
      className="absolute inset-x-0 flex items-center gap-1 px-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
      style={props.style}
    >
      <Chevron expanded={props.row.expanded} />
      <span>{props.row.label}</span>
      <Show
        when={props.loading}
        fallback={<span className="ml-auto pr-1 tabular-nums opacity-60">{props.row.count}</span>}
      >
        <Skeleton className="ml-auto h-2 w-4 rounded-sm" />
      </Show>
    </button>
  )
}

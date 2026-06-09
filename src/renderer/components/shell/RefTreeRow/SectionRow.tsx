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
      className="absolute inset-x-0 flex items-center gap-1.5 px-2 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground hover:text-foreground"
      style={props.style}
    >
      <Chevron expanded={props.row.expanded} />
      <span>{props.row.label}</span>
      <Show
        when={props.loading}
        fallback={
          <span className="inline-flex h-[18px] min-w-5 items-center justify-center rounded-full bg-muted-foreground/15 px-1.5 text-xs font-semibold tabular-nums">
            {props.row.count}
          </span>
        }
      >
        <Skeleton className="h-2 w-4 rounded-sm" />
      </Show>
    </button>
  )
}

import type { JSX } from 'solid-js'
import type { RefEmptyRow } from '@/lib/ref-tree'

interface EmptyRowProps {
  row: RefEmptyRow
  style: JSX.CSSProperties
}

export function EmptyRow(props: EmptyRowProps) {
  return (
    <div
      class="absolute inset-x-0 flex items-center px-6 text-xs text-muted-foreground/70"
      style={props.style}
    >
      {props.row.label}
    </div>
  )
}

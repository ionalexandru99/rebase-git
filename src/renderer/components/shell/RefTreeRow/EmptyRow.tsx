import type { CSSProperties } from 'react'
import type { RefEmptyRow } from '@/lib/ref-tree'

interface EmptyRowProps {
  row: RefEmptyRow
  style: CSSProperties
}

export function EmptyRow(props: EmptyRowProps) {
  return (
    <div
      className="absolute inset-x-0 flex items-center px-6 text-xs text-muted-foreground/70"
      style={props.style}
    >
      {props.row.label}
    </div>
  )
}

import type { RefEmptyRow } from '@/lib/ref-tree'

interface EmptyRowProps {
  row: RefEmptyRow
  style: React.CSSProperties
}

export function EmptyRow({ row, style }: EmptyRowProps) {
  return (
    <div
      className="absolute inset-x-0 flex items-center px-6 text-xs text-muted-foreground/70"
      style={style}
    >
      {row.label}
    </div>
  )
}

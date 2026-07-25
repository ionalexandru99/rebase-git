import { Skeleton } from '../ui/skeleton'

interface SkeletonRowsProps {
  graphRailWidth: number
  gridTail: string
  rowHeight: number
  viewportHeight: number
}

export function SkeletonRows(props: SkeletonRowsProps) {
  const count = Math.max(12, Math.ceil(props.viewportHeight / props.rowHeight) + 2)
  const gridTemplate = `${props.graphRailWidth}px minmax(0,1fr) ${props.gridTail}`
  const rows = Array.from({ length: count }, (_, position) => ({
    key: `skeleton-row-${position}`,
    width: 55 + ((position * 13) % 35)
  }))

  return (
    <ul aria-busy="true" aria-label="Loading commit history" className="px-0 py-1">
      {rows.map((row) => (
        <li
          key={row.key}
          className="grid items-center gap-1 px-0"
          style={{ height: `${props.rowHeight}px`, gridTemplateColumns: gridTemplate }}
        >
          <span aria-hidden="true" className="flex h-full items-center justify-end pr-1">
            <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/30" />
          </span>
          <span className="flex h-full min-w-0 items-center">
            <Skeleton className="h-3 rounded" style={{ width: `${row.width}%`, opacity: '0.7' }} />
          </span>
          <Skeleton className="h-3 w-20 rounded" style={{ opacity: '0.55' }} />
          <Skeleton className="h-3 w-12 rounded" style={{ opacity: '0.5' }} />
          <span className="flex justify-end pr-3">
            <Skeleton className="h-3 w-16 rounded" style={{ opacity: '0.5' }} />
          </span>
        </li>
      ))}
    </ul>
  )
}

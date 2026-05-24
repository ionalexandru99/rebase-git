import { Skeleton } from '@/components/ui/skeleton'
import type { RefSkeletonRow } from '@/lib/ref-tree'

interface SkeletonRowProps {
  row: RefSkeletonRow
  style: React.CSSProperties
}

const widths = ['60%', '78%', '52%', '70%']

export function SkeletonRowItem({ row, style }: SkeletonRowProps) {
  const width = widths[row.idx % widths.length]
  return (
    <div className="absolute inset-x-0 flex items-center gap-1.5 pr-2 pl-5" style={style}>
      <Skeleton className="size-3.5 shrink-0 rounded-sm opacity-60" />
      <Skeleton className="h-2.5 rounded" style={{ width, opacity: 0.6 }} />
    </div>
  )
}

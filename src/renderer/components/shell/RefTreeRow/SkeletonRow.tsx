import type { CSSProperties } from 'react'
import type { RefSkeletonRow } from '@/lib/ref-tree'
import { Skeleton } from '../../ui/skeleton'

interface SkeletonRowProps {
  row: RefSkeletonRow
  style: CSSProperties
}

const widths = ['60%', '78%', '52%', '70%']

export function SkeletonRowItem(props: SkeletonRowProps) {
  const width = widths[props.row.idx % widths.length]
  return (
    <div className="absolute inset-x-0 flex items-center gap-1.5 pr-2 pl-5" style={props.style}>
      <Skeleton className="size-3.5 shrink-0 rounded-sm opacity-60" />
      <Skeleton className="h-2.5 rounded" style={{ width, opacity: '0.6' }} />
    </div>
  )
}

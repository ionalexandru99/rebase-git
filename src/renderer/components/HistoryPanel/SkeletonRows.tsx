import { Skeleton } from '@/components/ui/skeleton'
import { ROW_H } from '@/lib/git-graph/canvas'

interface SkeletonRowsProps {
  gridTemplate: string
  viewportHeight: number
}

export function SkeletonRows({ gridTemplate, viewportHeight }: SkeletonRowsProps) {
  const count = Math.max(12, Math.ceil(viewportHeight / ROW_H) + 2)
  return (
    <ul aria-busy="true" aria-label="Loading commit history" className="px-0 py-1">
      {Array.from({ length: count }, (_, i) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholders
          key={i}
          className="grid items-center gap-1 px-0"
          style={{ height: ROW_H, gridTemplateColumns: gridTemplate }}
        >
          <span className="flex h-full items-center gap-2 pl-3">
            <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/30" />
            <Skeleton
              className="h-3 rounded"
              style={{ width: `${55 + ((i * 13) % 35)}%`, opacity: 0.7 }}
            />
          </span>
          <Skeleton className="h-3 w-20 rounded" style={{ opacity: 0.55 }} />
          <Skeleton className="h-3 w-12 rounded" style={{ opacity: 0.5 }} />
          <span className="flex justify-end pr-3">
            <Skeleton className="h-3 w-16 rounded" style={{ opacity: 0.5 }} />
          </span>
        </li>
      ))}
    </ul>
  )
}

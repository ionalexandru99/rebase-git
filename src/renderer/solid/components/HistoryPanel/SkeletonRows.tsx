import { For } from 'solid-js'
import { ROW_H } from '@/lib/git-graph/canvas'
import { Skeleton } from '../ui/skeleton'

interface SkeletonRowsProps {
  gridTemplate: string
  viewportHeight: number
}

export function SkeletonRows(props: SkeletonRowsProps) {
  const count = () => Math.max(12, Math.ceil(props.viewportHeight / ROW_H) + 2)
  return (
    <ul aria-busy="true" aria-label="Loading commit history" class="px-0 py-1">
      <For each={Array.from({ length: count() }, (_, index) => index)}>
        {(index) => (
          <li
            class="grid items-center gap-1 px-0"
            style={{ height: `${ROW_H}px`, 'grid-template-columns': props.gridTemplate }}
          >
            <span class="flex h-full items-center gap-2 pl-3">
              <span class="size-1.5 shrink-0 rounded-full bg-muted-foreground/30" />
              <Skeleton
                class="h-3 rounded"
                style={{ width: `${55 + ((index * 13) % 35)}%`, opacity: '0.7' }}
              />
            </span>
            <Skeleton class="h-3 w-20 rounded" style={{ opacity: '0.55' }} />
            <Skeleton class="h-3 w-12 rounded" style={{ opacity: '0.5' }} />
            <span class="flex justify-end pr-3">
              <Skeleton class="h-3 w-16 rounded" style={{ opacity: '0.5' }} />
            </span>
          </li>
        )}
      </For>
    </ul>
  )
}

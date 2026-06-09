import { laneColor } from '@/lib/git-graph/canvas'
import { For, Show } from '@/lib/react-compat'
import type { RefKind } from '@/lib/ref-tree'
import { cn } from '@/lib/utils'
import { parseFilterRefKey } from './selectors'

interface FocusRailProps {
  visibleRefs: ReadonlySet<string>
  onToggleRef?: (refKind: RefKind, fullPath: string) => void
}

function refColor(fullPath: string): string {
  let hash = 0
  for (let i = 0; i < fullPath.length; i++) {
    hash = (hash * 31 + fullPath.charCodeAt(i)) | 0
  }
  return laneColor(Math.abs(hash))
}

export function FocusRail(props: FocusRailProps) {
  const refs = () =>
    [...props.visibleRefs]
      .map(parseFilterRefKey)
      .filter((ref): ref is NonNullable<ReturnType<typeof parseFilterRefKey>> => ref !== null)
      .sort((a, b) => a.fullPath.localeCompare(b.fullPath))

  return (
    <Show when={refs().length > 0}>
      <div className="flex shrink-0 items-center gap-1 overflow-hidden border-b px-3 py-2.5">
        <For each={refs()}>
          {(ref, index) => {
            const color = refColor(ref.fullPath)
            return (
              <button
                type="button"
                title={props.onToggleRef ? `Hide ${ref.fullPath} from timeline` : undefined}
                onClick={() => props.onToggleRef?.(ref.kind, ref.fullPath)}
                className={cn(
                  'inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-semibold transition-colors',
                  !props.onToggleRef && 'pointer-events-none'
                )}
                style={{
                  color,
                  backgroundColor: `color-mix(in oklch, ${color} 16%, transparent)`
                }}
              >
                <Show when={index() === 0}>
                  <span className="font-medium text-muted-foreground">Visible:</span>
                </Show>
                <span
                  aria-hidden="true"
                  className="size-2 rounded-[3px]"
                  style={{ backgroundColor: color }}
                />
                {ref.fullPath}
              </button>
            )
          }}
        </For>
      </div>
    </Show>
  )
}

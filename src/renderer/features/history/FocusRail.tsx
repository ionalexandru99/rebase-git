import type { RefKind } from '@/features/refs/ref-tree'
import { cn } from '@/lib/utils'
import { parseFilterRefKey } from './selectors'

const UNRESOLVED_REF_COLOR = 'var(--muted-foreground)'

interface FocusRailProps {
  visibleRefs: ReadonlySet<string>
  colorByRefKey?: ReadonlyMap<string, string>
  onToggleRef?: (refKind: RefKind, fullPath: string) => void
}

export function FocusRail(props: FocusRailProps) {
  const refs = [...props.visibleRefs]
    .map(parseFilterRefKey)
    .filter((ref): ref is NonNullable<ReturnType<typeof parseFilterRefKey>> => ref !== null)
    .sort((a, b) => a.fullPath.localeCompare(b.fullPath))

  if (refs.length === 0) {
    return null
  }

  return (
    <div className="scroll-host flex shrink-0 items-center gap-1 overflow-x-auto border-b px-3 py-2.5">
      {refs.map((ref, index) => {
        const key = `${ref.kind}:${ref.fullPath}`
        const color = props.colorByRefKey?.get(key) ?? UNRESOLVED_REF_COLOR
        return (
          <button
            key={key}
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
            {index === 0 ? (
              <span className="font-medium text-muted-foreground">Visible:</span>
            ) : null}
            <span
              aria-hidden="true"
              className="size-2 rounded-[3px]"
              style={{ backgroundColor: color }}
            />
            {ref.fullPath}
          </button>
        )
      })}
    </div>
  )
}

import { type ParsedRef, refClass, splitRemoteRef } from '@/lib/git-graph/refs'
import { type JSX, Show } from '@/lib/react-compat'
import { cn } from '@/lib/utils'
import { RemoteProviderIcon } from '../RemoteProviderIcon'
import { Badge } from '../ui/badge'

const BASE_CLASS =
  'h-5 shrink-0 rounded-[var(--r-xs)] border-0 px-1.5 text-[11px] font-semibold tracking-tight'

function pillStyle(kind: ParsedRef['kind'], laneHex: string): JSX.CSSProperties | undefined {
  if (kind === 'branch' || kind === 'remote') {
    return {
      backgroundColor: `color-mix(in oklch, ${laneHex} 16%, transparent)`,
      color: laneHex
    }
  }
  return undefined
}

interface RefBadgeProps {
  parsedRef: ParsedRef
  laneHex: string
  remotes: Record<string, string>
}

export function RefBadge(props: RefBadgeProps) {
  const style = () => pillStyle(props.parsedRef.kind, props.laneHex)
  return (
    <Show
      when={props.parsedRef.kind === 'remote'}
      fallback={
        <Badge
          variant="outline"
          className={cn(BASE_CLASS, refClass(props.parsedRef.kind))}
          style={style()}
          title={props.parsedRef.label}
        >
          {props.parsedRef.label}
        </Badge>
      }
    >
      {(() => {
        const split = () => splitRemoteRef(props.parsedRef.label)
        return (
          <Badge
            variant="outline"
            className={cn(BASE_CLASS, 'gap-1.5', refClass(props.parsedRef.kind))}
            style={style()}
            title={props.parsedRef.label}
          >
            <RemoteProviderIcon url={props.remotes[split().remote]} className="!size-3.5" />
            {split().branch}
          </Badge>
        )
      })()}
    </Show>
  )
}

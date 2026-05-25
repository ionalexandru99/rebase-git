import { type JSX, Show } from 'solid-js'
import { type ParsedRef, refClass, splitRemoteRef } from '@/lib/git-graph/refs'
import { cn } from '@/lib/utils'
import { RemoteProviderIcon } from '../RemoteProviderIcon'
import { Badge } from '../ui/badge'

const BASE_CLASS = 'h-6 shrink-0 rounded-md border px-2.5 text-xs font-medium tracking-tight'

function pillStyle(kind: ParsedRef['kind'], laneHex: string): JSX.CSSProperties | undefined {
  if (kind === 'branch' || kind === 'remote') {
    return {
      'border-color': `${laneHex}66`,
      'background-color': `${laneHex}1f`,
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
          class={cn(BASE_CLASS, refClass(props.parsedRef.kind))}
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
            class={cn(BASE_CLASS, 'gap-1.5', refClass(props.parsedRef.kind))}
            style={style()}
            title={props.parsedRef.label}
          >
            <RemoteProviderIcon url={props.remotes[split().remote]} class="!size-3.5" />
            {split().branch}
          </Badge>
        )
      })()}
    </Show>
  )
}

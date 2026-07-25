import type { CSSProperties } from 'react'
import { type ParsedRef, refClass, splitRemoteRef } from '@/features/history/graph/refs'
import { cn } from '@/lib/utils'
import { Badge } from '../../components/ui/badge'
import { RemoteProviderIcon } from '../repos/RemoteProviderIcon'

const BASE_CLASS =
  'h-5 shrink-0 rounded-[var(--r-xs)] border-0 px-1.5 text-[11px] font-semibold tracking-tight'

function pillStyle(kind: ParsedRef['kind'], laneHex: string): CSSProperties | undefined {
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
  const style = pillStyle(props.parsedRef.kind, props.laneHex)
  if (props.parsedRef.kind === 'remote') {
    const split = splitRemoteRef(props.parsedRef.label)
    return (
      <Badge
        variant="outline"
        className={cn(BASE_CLASS, 'gap-1.5', refClass(props.parsedRef.kind))}
        style={style}
        title={props.parsedRef.label}
      >
        <RemoteProviderIcon url={props.remotes[split.remote]} className="!size-3.5" />
        {split.branch}
      </Badge>
    )
  }

  return (
    <Badge
      variant="outline"
      className={cn(BASE_CLASS, refClass(props.parsedRef.kind))}
      style={style}
      title={props.parsedRef.label}
    >
      {props.parsedRef.label}
    </Badge>
  )
}

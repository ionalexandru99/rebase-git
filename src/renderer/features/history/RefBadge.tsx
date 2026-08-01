import type { CSSProperties } from 'react'
import { type ParsedRef, refClass, splitRemoteRef } from '@/features/history/graph/refs'
import { cn } from '@/lib/utils'
import { Badge } from '../../components/ui/badge'
import { RemoteProviderIcon } from '../repos/RemoteProviderIcon'
import { refBadgeColor } from './ref-colors'

const BASE_CLASS =
  'h-5 shrink-0 rounded-[var(--r-xs)] border-0 px-1.5 text-[11px] font-semibold tracking-tight'

function pillStyle(
  kind: ParsedRef['kind'],
  branchName: string,
  badgeHex?: string
): CSSProperties | undefined {
  if (kind === 'branch' || kind === 'remote') {
    const resolvedHex = badgeHex ?? refBadgeColor(branchName)
    return {
      backgroundColor: `color-mix(in oklch, ${resolvedHex} 16%, transparent)`,
      color: resolvedHex
    }
  }
  return undefined
}

export function refBadgeName(parsedRef: ParsedRef): string {
  if (parsedRef.kind === 'remote') {
    return splitRemoteRef(parsedRef.label).branch
  }
  return parsedRef.label
}

interface RefBadgeProps {
  parsedRef: ParsedRef
  remotes: Record<string, string>
  badgeHex?: string
}

export function RefBadge(props: RefBadgeProps) {
  if (props.parsedRef.kind === 'remote') {
    const split = splitRemoteRef(props.parsedRef.label)
    return (
      <Badge
        variant="outline"
        className={cn(BASE_CLASS, 'gap-1.5', refClass(props.parsedRef.kind))}
        style={pillStyle(props.parsedRef.kind, split.branch, props.badgeHex)}
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
      style={pillStyle(props.parsedRef.kind, props.parsedRef.label, props.badgeHex)}
      title={props.parsedRef.label}
    >
      {props.parsedRef.label}
    </Badge>
  )
}

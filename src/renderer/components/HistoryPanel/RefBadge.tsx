import { RemoteProviderIcon } from '@/components/RemoteProviderIcon'
import { Badge } from '@/components/ui/badge'
import { type ParsedRef, pillStyle, refClass, splitRemoteRef } from '@/lib/git-graph/refs'
import { cn } from '@/lib/utils'

const BASE_CLASS = 'h-6 shrink-0 rounded-md border px-2.5 text-xs font-medium tracking-tight'

interface RefBadgeProps {
  ref: ParsedRef
  laneHex: string
  remotes: Record<string, string>
}

export function RefBadge({ ref, laneHex, remotes }: RefBadgeProps) {
  const style = pillStyle(ref.kind, laneHex)
  if (ref.kind === 'remote') {
    const { remote, branch } = splitRemoteRef(ref.label)
    return (
      <Badge
        variant="outline"
        className={cn(BASE_CLASS, 'gap-1.5', refClass(ref.kind))}
        style={style}
        title={ref.label}
      >
        <RemoteProviderIcon url={remotes[remote]} className="!size-3.5" />
        {branch}
      </Badge>
    )
  }
  return (
    <Badge
      variant="outline"
      className={cn(BASE_CLASS, refClass(ref.kind))}
      style={style}
      title={ref.label}
    >
      {ref.label}
    </Badge>
  )
}

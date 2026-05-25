import { cn } from '@/lib/utils'
import { Badge } from '../ui/badge'

export type StatusKind =
  | 'modified'
  | 'staged'
  | 'untracked'
  | 'conflicted'
  | 'deleted'
  | 'created'
  | 'renamed'

const glyphs: Record<StatusKind, string> = {
  modified: 'M',
  staged: 'A',
  created: 'A',
  untracked: '?',
  conflicted: '!',
  deleted: 'D',
  renamed: 'R'
}

function kindClass(kind: StatusKind): string {
  if (kind === 'conflicted') return 'border-destructive/40 bg-destructive/10 text-destructive'
  return ''
}

interface StatusBadgeProps {
  kind: StatusKind
}

export function StatusBadge(props: StatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      aria-label={props.kind}
      class={cn('px-1.5 text-xs uppercase', kindClass(props.kind))}
    >
      {glyphs[props.kind]}
    </Badge>
  )
}

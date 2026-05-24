import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

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

export function StatusBadge({ kind }: StatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      aria-label={kind}
      className={cn('px-1.5 font-mono text-xs uppercase', kindClass(kind))}
    >
      {glyphs[kind]}
    </Badge>
  )
}

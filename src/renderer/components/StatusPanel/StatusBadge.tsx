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
  staged: 'M',
  created: 'A',
  untracked: 'U',
  conflicted: '!',
  deleted: 'D',
  renamed: 'R'
}

const kindClass: Record<StatusKind, string> = {
  staged: 'bg-[var(--staged-bg)] text-add',
  created: 'bg-[var(--staged-bg)] text-add',
  modified: 'bg-[var(--modified-bg)] text-orange',
  renamed: 'bg-[var(--modified-bg)] text-orange',
  untracked: 'bg-[var(--untracked-bg)] text-blue',
  deleted: 'bg-[var(--deleted-bg)] text-del',
  conflicted: 'bg-orange/30 text-orange'
}

interface StatusBadgeProps {
  kind: StatusKind
}

export function StatusBadge(props: StatusBadgeProps) {
  return (
    <span
      role="img"
      aria-label={props.kind}
      className={`inline-flex size-[18px] shrink-0 items-center justify-center rounded-[var(--r-xs)] text-[11px] font-bold ${kindClass[props.kind]}`}
    >
      {glyphs[props.kind]}
    </span>
  )
}

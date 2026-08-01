import { formatCommitAge, formatCommitAgeShort } from '@/lib/format'

interface RefFreshnessLabelProps {
  lastCommitAt?: string
}

export function RefFreshnessLabel(props: RefFreshnessLabelProps) {
  if (!props.lastCommitAt) {
    return null
  }
  const now = Date.now()
  const label = formatCommitAgeShort(props.lastCommitAt, now)
  if (!label) {
    return null
  }
  return (
    <span
      data-testid="ref-freshness"
      className="ml-auto shrink-0 pl-2 pr-1 text-[11px] tabular-nums text-muted-foreground"
      title={`Last commit ${formatCommitAge(props.lastCommitAt, now)}`}
    >
      {label}
    </span>
  )
}

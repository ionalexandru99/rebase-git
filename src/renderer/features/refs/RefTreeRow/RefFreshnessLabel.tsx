import { formatCommitAge } from '@/lib/format'

interface RefFreshnessLabelProps {
  lastCommitAt?: string
}

export function RefFreshnessLabel(props: RefFreshnessLabelProps) {
  const label = props.lastCommitAt ? formatCommitAge(props.lastCommitAt, Date.now()) : ''
  if (!label) {
    return null
  }
  return (
    <span
      data-testid="ref-freshness"
      className="ml-auto shrink-0 pl-2 text-[11px] tabular-nums text-muted-foreground"
      title={`Last commit ${label}`}
    >
      {label}
    </span>
  )
}

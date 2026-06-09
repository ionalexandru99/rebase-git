const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric'
})

export function formatCommitDate(date: string): string {
  const t = new Date(date).getTime()
  if (Number.isNaN(t)) {
    return ''
  }
  return DATE_FORMATTER.format(t)
}

export function formatRelativeTime(timestamp: number, now: number): string {
  const elapsedSeconds = Math.max(0, Math.floor((now - timestamp) / 1000))
  if (elapsedSeconds < 60) {
    return 'just now'
  }
  const minutes = Math.floor(elapsedSeconds / 60)
  if (minutes < 60) {
    return `${minutes}m ago`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours}h ago`
  }
  return `${Math.floor(hours / 24)}d ago`
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
    .padEnd(1, '?')
}

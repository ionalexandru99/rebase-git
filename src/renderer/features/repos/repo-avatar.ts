const AVATAR_COLORS = [
  'var(--blue)',
  'var(--cyan)',
  'var(--green)',
  'var(--orange)',
  'var(--purple)',
  'var(--yellow)'
] as const

export function avatarInitials(name: string): string {
  const segments = name.split(/[^a-zA-Z0-9]+/).filter(Boolean)
  if (segments.length === 0) {
    return name.slice(0, 2).toUpperCase() || '?'
  }
  if (segments.length === 1) {
    return segments[0].slice(0, 2).toUpperCase()
  }
  return (segments[0][0] + segments[1][0]).toUpperCase()
}

export function avatarColor(key: string): string {
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

// Visual helpers for the shell — branch colors, author avatars,
// relative-time formatting. Kept light: only what the shell components
// (Topbar, Sidebar, Statusbar) and shared primitives use.

const BRANCH_HUES: Record<string, string> = {
  main: 'var(--primary)',
  master: 'var(--primary)',
  develop: 'oklch(0.78 0.13 198)'
}

function hashHue(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return h % 360
}

export function branchColor(name: string): string {
  if (BRANCH_HUES[name]) return BRANCH_HUES[name]
  if (name.startsWith('feat/')) return `oklch(0.78 0.13 ${(hashHue(name) % 90) + 200})`
  if (name.startsWith('fix/') || name.startsWith('hotfix/'))
    return `oklch(0.78 0.13 ${(hashHue(name) % 60) + 20})`
  if (name.startsWith('release/')) return 'oklch(0.78 0.13 12)'
  if (name.startsWith('chore/')) return 'oklch(0.78 0.07 80)'
  return `oklch(0.78 0.12 ${hashHue(name)})`
}

export function avatarInitials(name: string): string {
  return name
    .split(/[\s_\-/.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
    .padEnd(1, '?')
}

export function authorHue(name: string): number {
  return hashHue(name) || 32
}

export function authorColor(hue: number): string {
  return `oklch(0.74 0.10 ${hue})`
}

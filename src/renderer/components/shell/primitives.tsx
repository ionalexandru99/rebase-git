// Shared avatar primitive used by the shell pieces.

import { authorColor, authorHue, avatarInitials } from '@/lib/shell'

interface AvatarProps {
  name: string
  size?: number
  bot?: boolean
}

export function ShellAvatar({ name, size = 20, bot }: AvatarProps) {
  const hue = authorHue(name)
  return (
    <div
      className="shell-avatar"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.45,
        background: bot ? '#3a322a' : authorColor(hue),
        color: bot ? 'var(--fg-soft)' : '#1a1714'
      }}
    >
      {avatarInitials(name)}
    </div>
  )
}

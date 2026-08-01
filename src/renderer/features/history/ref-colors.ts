const REF_BADGE_PALETTE = [
  '#e28383',
  '#e2a783',
  '#e2ca83',
  '#d6e283',
  '#b3e283',
  '#8fe283',
  '#83e29b',
  '#83e2be',
  '#83e2e2',
  '#83bee2',
  '#839be2',
  '#8f83e2',
  '#b283e2',
  '#d683e2',
  '#e283ca',
  '#e283a7'
]

function hashName(name: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < name.length; index += 1) {
    hash ^= name.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

export function assignRefBadgeColors(names: readonly string[]): string[] {
  const used: string[] = []
  return names.map((name) => {
    const color = refBadgeColor(name, used)
    used.push(color)
    return color
  })
}

export function refBadgeColor(name: string, avoid: readonly string[] = []): string {
  const paletteSize = REF_BADGE_PALETTE.length
  const start = hashName(name) % paletteSize
  for (let offset = 0; offset < paletteSize; offset += 1) {
    const candidate = REF_BADGE_PALETTE[(start + offset) % paletteSize]
    if (!avoid.includes(candidate)) {
      return candidate
    }
  }
  return REF_BADGE_PALETTE[start]
}

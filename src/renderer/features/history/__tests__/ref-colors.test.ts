import { describe, expect, it } from 'vitest'
import { refBadgeColor } from '../ref-colors'

describe('refBadgeColor', () => {
  it('gives the same ref the same color every time', () => {
    expect(refBadgeColor('main')).toBe(refBadgeColor('main'))
  })

  it('steps past colors already used on the same line, so neighbours always differ', () => {
    const first = refBadgeColor('main')
    expect(refBadgeColor('feature/streaming', [first])).not.toBe(first)
    expect(refBadgeColor('main', [first])).not.toBe(first)
  })

  it('keeps the stable color when it is not taken', () => {
    const stable = refBadgeColor('feature/streaming')
    const other = refBadgeColor('main', [stable])
    expect(refBadgeColor('feature/streaming', [other])).toBe(stable)
  })

  it('produces a dark-theme-legible hex color', () => {
    expect(refBadgeColor('main')).toMatch(/^#[0-9a-f]{6}$/)
  })
})

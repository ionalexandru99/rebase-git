import { describe, expect, it } from 'vitest'
import { BACKGROUND_COLORS, resolveBackgroundColor } from '../theme'

describe('resolveBackgroundColor', () => {
  it('returns the dark background for dark', () => {
    expect(resolveBackgroundColor('dark')).toBe(BACKGROUND_COLORS.dark)
  })

  it('returns the light background for light', () => {
    expect(resolveBackgroundColor('light')).toBe(BACKGROUND_COLORS.light)
  })

  it('falls back to dark for unknown values', () => {
    expect(resolveBackgroundColor('')).toBe(BACKGROUND_COLORS.dark)
    expect(resolveBackgroundColor('system')).toBe(BACKGROUND_COLORS.dark)
  })
})

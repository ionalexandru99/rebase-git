import { describe, expect, it } from 'vitest'
import { deriveLocalShortName } from '../checkout'

describe('deriveLocalShortName', () => {
  it('strips a single-segment remote prefix', () => {
    expect(deriveLocalShortName('origin/main')).toBe('main')
  })

  it('preserves nested branch names after the remote prefix', () => {
    expect(deriveLocalShortName('origin/feature/foo')).toBe('feature/foo')
    expect(deriveLocalShortName('upstream/x/y/z')).toBe('x/y/z')
  })

  it('returns the input unchanged when there is no slash', () => {
    expect(deriveLocalShortName('nopath')).toBe('nopath')
  })
})

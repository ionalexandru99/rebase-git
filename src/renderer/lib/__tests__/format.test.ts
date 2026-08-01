import { describe, expect, it } from 'vitest'
import { formatCommitAge, formatCommitAgeShort } from '@/lib/format'

const NOW = Date.parse('2026-08-01T12:00:00.000Z')

describe('formatCommitAge', () => {
  it('reads recent commits as an age', () => {
    expect(formatCommitAge('2026-08-01T11:58:00.000Z', NOW)).toBe('2m ago')
    expect(formatCommitAge('2026-07-30T12:00:00.000Z', NOW)).toBe('2d ago')
  })

  it('falls back to a calendar date once a commit is older than a month', () => {
    expect(formatCommitAge('2026-06-01T12:00:00.000Z', NOW)).toBe(
      new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      }).format(Date.parse('2026-06-01T12:00:00.000Z'))
    )
  })

  it('stays empty for a date git could not give us', () => {
    expect(formatCommitAge('not a date', NOW)).toBe('')
  })
})

describe('formatCommitAgeShort', () => {
  it('compresses ages to a bare unit', () => {
    expect(formatCommitAgeShort('2026-08-01T11:59:30.000Z', NOW)).toBe('now')
    expect(formatCommitAgeShort('2026-08-01T11:58:00.000Z', NOW)).toBe('2m')
    expect(formatCommitAgeShort('2026-08-01T06:00:00.000Z', NOW)).toBe('6h')
    expect(formatCommitAgeShort('2026-07-29T12:00:00.000Z', NOW)).toBe('3d')
  })

  it('falls back to a calendar date once a commit is older than a month', () => {
    expect(formatCommitAgeShort('2026-06-01T12:00:00.000Z', NOW)).toBe(
      new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      }).format(Date.parse('2026-06-01T12:00:00.000Z'))
    )
  })

  it('stays empty for a date git could not give us', () => {
    expect(formatCommitAgeShort('not a date', NOW)).toBe('')
  })
})

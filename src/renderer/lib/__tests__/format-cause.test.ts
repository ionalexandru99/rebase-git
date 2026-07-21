import { describe, expect, it } from 'vitest'
import { formatCause } from '@/lib/format-cause'

describe('formatCause', () => {
  it.each([
    [new Error('failed'), 'failed'],
    ['failed', 'failed'],
    [42, '42']
  ])('formats %j as %s', (cause, expected) => {
    expect(formatCause(cause)).toBe(expected)
  })
})

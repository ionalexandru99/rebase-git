import { describe, expect, it } from 'vitest'
import { hunkAtLine } from '@/features/diff/hunk-at-line'

const hunk = (
  header: string,
  oldStart: number,
  oldCount: number,
  newStart: number,
  newCount: number
) => ({
  header,
  oldStart,
  oldCount,
  newStart,
  newCount,
  lines: [],
  raw: ''
})

const first = hunk('@@ -1,3 +1,4 @@', 1, 3, 1, 4)
const second = hunk('@@ -28,3 +29,3 @@ tail', 28, 3, 29, 3)
const pureDeletion = hunk('@@ -50,2 +51,0 @@', 50, 2, 51, 0)
const hunks = [first, second, pureDeletion]

describe('hunkAtLine', () => {
  it('resolves an additions-side line to the hunk spanning it in the new file', () => {
    expect(hunkAtLine(hunks, 'additions', 1)).toBe(first)
    expect(hunkAtLine(hunks, 'additions', 4)).toBe(first)
    expect(hunkAtLine(hunks, 'additions', 29)).toBe(second)
  })

  it('resolves a deletions-side line via old-file numbering', () => {
    expect(hunkAtLine(hunks, 'deletions', 28)).toBe(second)
    expect(hunkAtLine(hunks, 'deletions', 50)).toBe(pureDeletion)
  })

  it('returns null for lines outside every hunk', () => {
    expect(hunkAtLine(hunks, 'additions', 5)).toBeNull()
    expect(hunkAtLine(hunks, 'additions', 51)).toBeNull()
    expect(hunkAtLine([], 'additions', 1)).toBeNull()
  })

  it('never matches the empty side of a pure deletion hunk', () => {
    expect(hunkAtLine([pureDeletion], 'additions', 51)).toBeNull()
  })
})

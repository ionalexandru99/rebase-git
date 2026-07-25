import type { DiffHunk, DiffLine } from '@shared/schemas/git'
import { describe, expect, it } from 'vitest'
import { HUNK_RANGE_RE, remapHunk } from '@/features/diff/diff-merge'

const line = (
  kind: DiffLine['kind'],
  oldLine: number | null,
  newLine: number | null
): DiffLine => ({
  kind,
  text: '',
  oldLine,
  newLine
})

const hunk = (overrides: Partial<DiffHunk> = {}): DiffHunk => ({
  header: '@@ -10,3 +10,3 @@',
  oldStart: 10,
  oldCount: 3,
  newStart: 10,
  newCount: 3,
  lines: [line('context', 10, 10), line('del', 11, null), line('add', null, 11)],
  ...overrides
})

describe('remapHunk', () => {
  it('shifts starts, rebuilds the header, and shifts each line for a positive shift', () => {
    const result = remapHunk(hunk(), 5, 7)

    expect(result.oldStart).toBe(15)
    expect(result.newStart).toBe(17)
    expect(result.header).toBe('@@ -15,3 +17,3 @@')
    expect(result.lines).toEqual([
      line('context', 15, 17),
      line('del', 16, null),
      line('add', null, 18)
    ])
  })

  it('shifts each axis independently for negative shifts', () => {
    const result = remapHunk(hunk({ oldStart: 20, newStart: 20 }), -4, -6)

    expect(result.oldStart).toBe(16)
    expect(result.newStart).toBe(14)
    expect(result.header).toBe('@@ -16,3 +14,3 @@')
    expect(result.lines[0]).toEqual(line('context', 6, 4))
  })

  it('returns the same hunk reference when both shifts are zero', () => {
    const input = hunk()
    const result = remapHunk(input, 0, 0)

    expect(result).toBe(input)
    expect(result.lines).toBe(input.lines)
  })

  it('preserves the header tail after the range', () => {
    const result = remapHunk(hunk({ header: '@@ -10,3 +10,3 @@ function render() {' }), 2, 2)

    expect(result.header).toBe('@@ -12,3 +12,3 @@ function render() {')
  })

  it('carries oldCount and newCount through unchanged while only starts shift', () => {
    const result = remapHunk(hunk({ header: '@@ -10,4 +10,9 @@', oldCount: 4, newCount: 9 }), 1, 1)

    expect(result.oldCount).toBe(4)
    expect(result.newCount).toBe(9)
    expect(result.header).toBe('@@ -11,4 +11,9 @@')
  })

  it('leaves null old/new line numbers as null under a non-zero shift', () => {
    const result = remapHunk(
      hunk({ lines: [line('del', 11, null), line('add', null, 11)] }),
      100,
      100
    )

    expect(result.lines).toEqual([line('del', 111, null), line('add', null, 111)])
  })
})

describe('HUNK_RANGE_RE', () => {
  it('matches range headers with and without counts', () => {
    expect(HUNK_RANGE_RE.test('@@ -1 +1 @@')).toBe(true)
    expect(HUNK_RANGE_RE.test('@@ -10,3 +12,4 @@')).toBe(true)
    expect(HUNK_RANGE_RE.test('@@ -10,3 +12,4 @@ function render() {')).toBe(true)
  })

  it('does not match malformed headers', () => {
    expect(HUNK_RANGE_RE.test('@@ -10 +10')).toBe(false)
    expect(HUNK_RANGE_RE.test('@@ +12,4 -10,3 @@')).toBe(false)
    expect(HUNK_RANGE_RE.test(' @@ -1 +1 @@')).toBe(false)
    expect(HUNK_RANGE_RE.test('not a hunk header')).toBe(false)
  })
})

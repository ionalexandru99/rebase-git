import type { ParsedHunk } from '@shared/unified-diff'

export type DiffSide = 'additions' | 'deletions'

export function hunkAtLine(
  hunks: readonly ParsedHunk[],
  side: DiffSide,
  lineNumber: number
): ParsedHunk | null {
  for (const hunk of hunks) {
    const start = side === 'additions' ? hunk.newStart : hunk.oldStart
    const count = side === 'additions' ? hunk.newCount : hunk.oldCount
    if (count > 0 && lineNumber >= start && lineNumber < start + count) {
      return hunk
    }
  }
  return null
}

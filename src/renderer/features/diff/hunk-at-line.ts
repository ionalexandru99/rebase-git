import type { DiffHunk } from '@shared/schemas/git'

export type DiffSide = 'additions' | 'deletions'

export function hunkAtLine(
  hunks: readonly DiffHunk[],
  side: DiffSide,
  lineNumber: number
): DiffHunk | null {
  for (const hunk of hunks) {
    const start = side === 'additions' ? hunk.newStart : hunk.oldStart
    const count = side === 'additions' ? hunk.newCount : hunk.oldCount
    if (count > 0 && lineNumber >= start && lineNumber < start + count) {
      return hunk
    }
  }
  return null
}

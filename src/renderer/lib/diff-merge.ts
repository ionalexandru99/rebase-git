import type { DiffHunk } from '@shared/schemas/git'

export interface HunkEntry {
  hunk: DiffHunk
  display: DiffHunk
  staged: boolean
  indexStart: number
}

export interface PendingHunk extends HunkEntry {
  file: string
  op: 'stage' | 'unstage'
  opHeader: string
  key: string
}

export const HUNK_RANGE_RE = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/

// Shift a hunk's line numbers so a hunk read in one diff (staged or worktree) lines up with the
// other side's coordinates. A zero shift returns the hunk untouched to avoid copying.
export function remapHunk(hunk: DiffHunk, oldShift: number, newShift: number): DiffHunk {
  if (oldShift === 0 && newShift === 0) {
    return hunk
  }
  const oldStart = hunk.oldStart + oldShift
  const newStart = hunk.newStart + newShift
  const tail = hunk.header.replace(HUNK_RANGE_RE, '')
  return {
    ...hunk,
    oldStart,
    newStart,
    header: `@@ -${oldStart},${hunk.oldCount} +${newStart},${hunk.newCount} @@${tail}`,
    lines: hunk.lines.map((line) => ({
      ...line,
      oldLine: line.oldLine === null ? null : line.oldLine + oldShift,
      newLine: line.newLine === null ? null : line.newLine + newShift
    }))
  }
}

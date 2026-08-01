import type { GitStatus } from '@/types'

export interface WorkingCopyCounts {
  staged: number
  unstaged: number
  conflicts: number
}

const EMPTY_COUNTS: WorkingCopyCounts = { staged: 0, unstaged: 0, conflicts: 0 }

function countFromCodes(status: GitStatus, conflicted: ReadonlySet<string>): WorkingCopyCounts {
  let staged = 0
  let unstaged = 0
  for (const entry of status.files) {
    if (conflicted.has(entry.path)) {
      continue
    }
    if (entry.index === '?' || entry.working_dir === '?') {
      unstaged++
      continue
    }
    if (entry.index !== ' ') {
      staged++
    }
    if (entry.working_dir !== ' ') {
      unstaged++
    }
  }
  return { staged, unstaged, conflicts: conflicted.size }
}

function countFromBuckets(status: GitStatus, conflicted: ReadonlySet<string>): WorkingCopyCounts {
  const stagedFiles = new Set(
    [...status.staged, ...status.created, ...status.renamed.map((rename) => rename.to)].filter(
      (file) => !conflicted.has(file)
    )
  )
  const unstagedFiles = new Set(
    [...status.modified, ...status.deleted, ...status.not_added].filter(
      (file) => !conflicted.has(file) && !stagedFiles.has(file)
    )
  )
  return { staged: stagedFiles.size, unstaged: unstagedFiles.size, conflicts: conflicted.size }
}

export function summarizeWorkingCopy(status: GitStatus | null | undefined): WorkingCopyCounts {
  if (!status) {
    return EMPTY_COUNTS
  }
  const conflicted = new Set(status.conflicted)
  return status.files.length > 0
    ? countFromCodes(status, conflicted)
    : countFromBuckets(status, conflicted)
}

export function workingCopySummaryText(counts: WorkingCopyCounts): string {
  if (counts.staged === 0 && counts.unstaged === 0 && counts.conflicts === 0) {
    return 'No changes'
  }
  const parts = [`${counts.staged} staged`, `${counts.unstaged} unstaged`]
  if (counts.conflicts > 0) {
    parts.push(`${counts.conflicts} conflict${counts.conflicts === 1 ? '' : 's'}`)
  }
  return parts.join(' · ')
}

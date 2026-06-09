import type { GitStatus } from '@/types'

export type StatusFileKind =
  | 'conflicted'
  | 'created'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'untracked'

export type FileStageState = 'staged' | 'partial' | 'unstaged'

export interface UnifiedFileRow {
  file: string
  display?: string
  fileKind: StatusFileKind
  stageState: FileStageState
  isConflicted: boolean
  isUntracked: boolean
}

const isUntrackedCode = (index: string, workingDir: string): boolean =>
  index === '?' || workingDir === '?'

function kindFromCodes(index: string, workingDir: string): StatusFileKind {
  const code = index !== ' ' && index !== '?' ? index : workingDir
  switch (code) {
    case 'A':
      return 'created'
    case 'D':
      return 'deleted'
    case 'R':
    case 'C':
      return 'renamed'
    default:
      return 'modified'
  }
}

function buildFromCodes(status: GitStatus): UnifiedFileRow[] {
  const conflictedSet = new Set(status.conflicted)
  const renameDisplay = new Map(
    status.renamed.map((entry) => [entry.to, `${entry.from} → ${entry.to}`])
  )

  const rows: UnifiedFileRow[] = []
  for (const entry of status.files ?? []) {
    const conflicted = conflictedSet.has(entry.path)
    const untracked = isUntrackedCode(entry.index, entry.working_dir)

    let stageState: FileStageState
    if (conflicted || untracked) {
      stageState = 'unstaged'
    } else {
      const hasStaged = entry.index !== ' '
      const hasUnstaged = entry.working_dir !== ' '
      stageState = hasStaged && hasUnstaged ? 'partial' : hasStaged ? 'staged' : 'unstaged'
    }

    const fileKind: StatusFileKind = conflicted
      ? 'conflicted'
      : untracked
        ? 'untracked'
        : kindFromCodes(entry.index, entry.working_dir)

    rows.push({
      file: entry.path,
      display: renameDisplay.get(entry.path),
      fileKind,
      stageState,
      isConflicted: conflicted,
      isUntracked: untracked
    })
  }
  return rows
}

function buildFromBuckets(status: GitStatus): UnifiedFileRow[] {
  const rows: UnifiedFileRow[] = []
  const seen = new Set<string>()
  const push = (row: UnifiedFileRow) => {
    if (seen.has(row.file)) {
      return
    }
    seen.add(row.file)
    rows.push(row)
  }

  const stagedSet = new Set([...status.staged, ...status.created])
  const unstagedSet = new Set([...status.modified, ...status.deleted])

  for (const file of status.conflicted) {
    push({
      file,
      fileKind: 'conflicted',
      stageState: 'unstaged',
      isConflicted: true,
      isUntracked: false
    })
  }
  for (const file of status.created) {
    push({
      file,
      fileKind: 'created',
      stageState: unstagedSet.has(file) ? 'partial' : 'staged',
      isConflicted: false,
      isUntracked: false
    })
  }
  for (const file of status.staged) {
    push({
      file,
      fileKind: 'modified',
      stageState: unstagedSet.has(file) ? 'partial' : 'staged',
      isConflicted: false,
      isUntracked: false
    })
  }
  for (const file of status.modified) {
    push({
      file,
      fileKind: 'modified',
      stageState: stagedSet.has(file) ? 'partial' : 'unstaged',
      isConflicted: false,
      isUntracked: false
    })
  }
  for (const file of status.deleted) {
    push({
      file,
      fileKind: 'deleted',
      stageState: stagedSet.has(file) ? 'partial' : 'unstaged',
      isConflicted: false,
      isUntracked: false
    })
  }
  for (const entry of status.renamed) {
    push({
      file: entry.to,
      display: `${entry.from} → ${entry.to}`,
      fileKind: 'renamed',
      stageState: 'staged',
      isConflicted: false,
      isUntracked: false
    })
  }
  for (const file of status.not_added) {
    push({
      file,
      fileKind: 'untracked',
      stageState: 'unstaged',
      isConflicted: false,
      isUntracked: true
    })
  }
  return rows
}

let warnedMissingFileCodes = false

export function buildUnifiedFileRows(status: GitStatus): UnifiedFileRow[] {
  const hasCodes = (status.files?.length ?? 0) > 0
  const rows = hasCodes ? buildFromCodes(status) : buildFromBuckets(status)
  if (!hasCodes && rows.length > 0 && !warnedMissingFileCodes) {
    warnedMissingFileCodes = true
    console.warn(
      '[status] response has no raw porcelain file codes; staged/partial states are approximate. Is the sidecar build outdated?'
    )
  }
  return rows.sort((left, right) => left.file.localeCompare(right.file))
}

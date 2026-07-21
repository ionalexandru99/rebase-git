import type { HeadCommitFile } from '@shared/schemas/git'
import { dropStateOf, type FileDrops, type HeadDropState } from '@/lib/amend-drops'
import type { GitStatus } from '@/types'

export type StatusFileKind =
  | 'conflicted'
  | 'created'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'untracked'

export type FileStageState = 'staged' | 'partial' | 'unstaged'

export type FileRowSource = 'worktree' | 'head-commit'

export interface UnifiedFileRow {
  file: string
  renameSource?: string
  display?: string
  fileKind: StatusFileKind
  stageState: FileStageState
  isConflicted: boolean
  isUntracked: boolean
  source: FileRowSource
  dropState?: HeadDropState
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
  const renameByDestination = new Map(status.renamed.map((entry) => [entry.to, entry]))

  const rows: UnifiedFileRow[] = []
  for (const entry of status.files ?? []) {
    const conflicted = conflictedSet.has(entry.path)
    const untracked = isUntrackedCode(entry.index, entry.working_dir)
    const rename = renameByDestination.get(entry.path)

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
      renameSource: rename?.from,
      display: rename ? `${rename.from} → ${rename.to}` : undefined,
      fileKind,
      stageState,
      isConflicted: conflicted,
      isUntracked: untracked,
      source: 'worktree'
    })
  }
  return rows
}

function buildFromBuckets(status: GitStatus): UnifiedFileRow[] {
  const rows: UnifiedFileRow[] = []
  const seen = new Set<string>()
  const push = (row: Omit<UnifiedFileRow, 'source'>) => {
    if (seen.has(row.file)) {
      return
    }
    seen.add(row.file)
    rows.push({ ...row, source: 'worktree' })
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
  for (const entry of status.renamed) {
    push({
      file: entry.to,
      renameSource: entry.from,
      display: `${entry.from} → ${entry.to}`,
      fileKind: 'renamed',
      stageState: 'staged',
      isConflicted: false,
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

function headFileKind(status: string): StatusFileKind {
  switch (status[0]) {
    case 'A':
      return 'created'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    default:
      return 'modified'
  }
}

export function buildHeadCommitRows(files: HeadCommitFile[], drops: FileDrops): UnifiedFileRow[] {
  return files
    .map((file) => ({
      file: file.path,
      renameSource: file.renameSource,
      display: file.renameSource ? `${file.renameSource} → ${file.path}` : undefined,
      fileKind: headFileKind(file.status),
      stageState: 'staged' as FileStageState,
      isConflicted: false,
      isUntracked: false,
      source: 'head-commit' as FileRowSource,
      dropState: dropStateOf(drops, file.path)
    }))
    .sort((left, right) => left.file.localeCompare(right.file))
}

export function buildStagedFilePaths(rows: readonly UnifiedFileRow[]): string[] {
  return rows
    .filter((row) => !row.isConflicted && row.stageState !== 'unstaged')
    .flatMap((row) => (row.renameSource ? [row.renameSource, row.file] : [row.file]))
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

import type { GitStatus } from '@/types'

export type StatusFileKind =
  | 'conflicted'
  | 'staged'
  | 'created'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'untracked'

export type StatusSectionKind = 'conflicted' | 'staged' | 'changes' | 'untracked'

export type StatusFileRow =
  | {
      kind: 'section'
      sectionKind: StatusSectionKind
      label: string
      count: number
      files: string[]
    }
  | {
      kind: 'file'
      file: string
      display?: string
      fileKind: StatusFileKind
      isStaged: boolean
    }

export function buildStatusFileRows(status: GitStatus): StatusFileRow[] {
  const rows: StatusFileRow[] = []

  if (status.conflicted.length > 0) {
    rows.push({
      kind: 'section',
      sectionKind: 'conflicted',
      label: 'Conflicts',
      count: status.conflicted.length,
      files: [...status.conflicted]
    })
    for (const file of status.conflicted) {
      rows.push({ kind: 'file', file, fileKind: 'conflicted', isStaged: false })
    }
  }

  const stagedFiles = [...status.staged, ...status.created]
  rows.push({
    kind: 'section',
    sectionKind: 'staged',
    label: 'Staged',
    count: stagedFiles.length,
    files: stagedFiles
  })
  for (const file of status.staged) {
    rows.push({ kind: 'file', file, fileKind: 'staged', isStaged: true })
  }
  for (const file of status.created) {
    rows.push({ kind: 'file', file, fileKind: 'created', isStaged: true })
  }

  const changedFiles = [
    ...status.modified,
    ...status.deleted,
    ...status.renamed.map((entry) => entry.to)
  ]
  rows.push({
    kind: 'section',
    sectionKind: 'changes',
    label: 'Changes',
    count: changedFiles.length,
    files: changedFiles
  })
  for (const file of status.modified) {
    rows.push({ kind: 'file', file, fileKind: 'modified', isStaged: false })
  }
  for (const file of status.deleted) {
    rows.push({ kind: 'file', file, fileKind: 'deleted', isStaged: false })
  }
  for (const entry of status.renamed) {
    rows.push({
      kind: 'file',
      file: entry.to,
      display: `${entry.from} → ${entry.to}`,
      fileKind: 'renamed',
      isStaged: false
    })
  }

  rows.push({
    kind: 'section',
    sectionKind: 'untracked',
    label: 'Untracked',
    count: status.not_added.length,
    files: [...status.not_added]
  })
  for (const file of status.not_added) {
    rows.push({ kind: 'file', file, fileKind: 'untracked', isStaged: false })
  }

  return rows
}

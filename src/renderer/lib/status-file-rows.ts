import type { GitStatus } from '@/types'

export type StatusFileRow =
  | { kind: 'section'; label: string; count: number }
  | {
      kind: 'file'
      file: string
      display?: string
      fileKind:
        | 'conflicted'
        | 'staged'
        | 'created'
        | 'modified'
        | 'deleted'
        | 'renamed'
        | 'untracked'
      actionLabel?: string
    }

export function buildStatusFileRows(status: GitStatus): StatusFileRow[] {
  const rows: StatusFileRow[] = []

  if (status.conflicted.length > 0) {
    rows.push({ kind: 'section', label: 'Conflicted', count: status.conflicted.length })
    for (const file of status.conflicted) {
      rows.push({ kind: 'file', file, fileKind: 'conflicted' })
    }
  }

  const stagedCount = status.staged.length + status.created.length
  rows.push({ kind: 'section', label: 'Staged', count: stagedCount })
  for (const file of status.staged) {
    rows.push({ kind: 'file', file, fileKind: 'staged', actionLabel: 'Unstage' })
  }
  for (const file of status.created) {
    rows.push({ kind: 'file', file, fileKind: 'created', actionLabel: 'Unstage' })
  }

  const changesCount = status.modified.length + status.deleted.length + status.renamed.length
  rows.push({ kind: 'section', label: 'Changes', count: changesCount })
  for (const file of status.modified) {
    rows.push({ kind: 'file', file, fileKind: 'modified', actionLabel: 'Stage' })
  }
  for (const file of status.deleted) {
    rows.push({ kind: 'file', file, fileKind: 'deleted', actionLabel: 'Stage' })
  }
  for (const entry of status.renamed) {
    rows.push({
      kind: 'file',
      file: entry.to,
      display: `${entry.from} → ${entry.to}`,
      fileKind: 'renamed'
    })
  }

  rows.push({ kind: 'section', label: 'Untracked', count: status.not_added.length })
  for (const file of status.not_added) {
    rows.push({ kind: 'file', file, fileKind: 'untracked', actionLabel: 'Stage' })
  }

  return rows
}

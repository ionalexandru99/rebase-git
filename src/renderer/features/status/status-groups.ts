import type { UnifiedFileRow } from '@/features/status/status-file-rows'

export type StatusGroupKind = 'conflicts' | 'staged' | 'unstaged'

export type FileRowGroup = StatusGroupKind | 'head-commit'

export interface StatusGroup {
  kind: StatusGroupKind
  label: string
  rows: UnifiedFileRow[]
}

export interface StatusGroupRow {
  row: UnifiedFileRow
  group: StatusGroupKind
}

const GROUP_LABELS: Record<StatusGroupKind, string> = {
  conflicts: 'Conflicts',
  staged: 'Staged',
  unstaged: 'Unstaged'
}

const GROUP_ORDER: StatusGroupKind[] = ['conflicts', 'staged', 'unstaged']

export function buildStatusGroups(rows: readonly UnifiedFileRow[]): StatusGroup[] {
  const members: Record<StatusGroupKind, UnifiedFileRow[]> = {
    conflicts: [],
    staged: [],
    unstaged: []
  }
  for (const row of rows) {
    if (row.isConflicted) {
      members.conflicts.push(row)
      continue
    }
    if (row.stageState !== 'unstaged') {
      members.staged.push(row)
    }
    if (row.stageState !== 'staged') {
      members.unstaged.push(row)
    }
  }
  return GROUP_ORDER.filter((kind) => members[kind].length > 0).map((kind) => ({
    kind,
    label: GROUP_LABELS[kind],
    rows: members[kind]
  }))
}

export function flattenStatusGroups(groups: readonly StatusGroup[]): StatusGroupRow[] {
  return groups.flatMap((group) => group.rows.map((row) => ({ row, group: group.kind })))
}

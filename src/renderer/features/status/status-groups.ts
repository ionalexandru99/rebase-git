import type { UnifiedFileRow } from '@/features/status/status-file-rows'

export type StatusGroupKind = 'conflicts' | 'staged' | 'unstaged'

/** The amend list is not a staging side, so it sits alongside the three working-copy groups. */
export type FileRowGroup = StatusGroupKind | 'head-commit'

export interface StatusGroup {
  kind: StatusGroupKind
  label: string
  rows: UnifiedFileRow[]
}

/** A row together with the group it renders in — the pair a selection has to name. */
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
    // A partially-staged file belongs to both sides: each row acts on, and diffs, its own side.
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

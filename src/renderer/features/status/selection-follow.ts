import type { StatusGroupKind, StatusGroupRow } from '@/features/status/status-groups'

export interface GroupedSelection {
  file: string
  group: StatusGroupKind
}

export type SelectionFollow =
  | { kind: 'keep' }
  | { kind: 'clear' }
  | { kind: 'select'; file: string; renameSource?: string; group: StatusGroupKind }

interface FollowInput {
  selected: GroupedSelection | null
  previous: readonly StatusGroupRow[]
  next: readonly StatusGroupRow[]
}

const select = (entry: StatusGroupRow): SelectionFollow => ({
  kind: 'select',
  file: entry.row.file,
  renameSource: entry.row.renameSource,
  group: entry.group
})

const find = (rows: readonly StatusGroupRow[], file: string, group: StatusGroupKind) =>
  rows.find((entry) => entry.row.file === file && entry.group === group)

export function followSelection(input: FollowInput): SelectionFollow {
  const { selected, previous, next } = input
  if (next.length === 0) {
    return selected ? { kind: 'clear' } : { kind: 'keep' }
  }
  const first = next[0]
  if (!selected || !first) {
    return first ? select(first) : { kind: 'keep' }
  }
  if (find(next, selected.file, selected.group)) {
    return { kind: 'keep' }
  }
  const moved = next.find((entry) => entry.row.file === selected.file)
  if (moved) {
    return select(moved)
  }
  const groupBefore = previous.filter((entry) => entry.group === selected.group)
  const vanishedAt = groupBefore.findIndex((entry) => entry.row.file === selected.file)
  if (vanishedAt >= 0) {
    const below = groupBefore.slice(vanishedAt + 1)
    const above = groupBefore.slice(0, vanishedAt).reverse()
    for (const candidate of [...below, ...above]) {
      const survivor = find(next, candidate.row.file, candidate.group)
      if (survivor) {
        return select(survivor)
      }
    }
  }
  return select(first)
}

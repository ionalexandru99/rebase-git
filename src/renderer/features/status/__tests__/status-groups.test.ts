import { describe, expect, it } from 'vitest'
import type { FileStageState, UnifiedFileRow } from '@/features/status/status-file-rows'
import { buildStatusGroups, flattenStatusGroups } from '@/features/status/status-groups'

const row = (file: string, stageState: FileStageState, overrides: Partial<UnifiedFileRow> = {}) =>
  ({
    file,
    fileKind: 'modified',
    stageState,
    isConflicted: false,
    isUntracked: false,
    source: 'worktree',
    ...overrides
  }) satisfies UnifiedFileRow

describe('buildStatusGroups', () => {
  it('splits rows into staged and unstaged groups', () => {
    const groups = buildStatusGroups([row('a.ts', 'unstaged'), row('b.ts', 'staged')])

    expect(groups.map((group) => group.kind)).toEqual(['staged', 'unstaged'])
    expect(groups[0]?.rows.map((entry) => entry.file)).toEqual(['b.ts'])
    expect(groups[1]?.rows.map((entry) => entry.file)).toEqual(['a.ts'])
  })

  it('sorts conflicts above everything else', () => {
    const groups = buildStatusGroups([
      row('a.ts', 'unstaged'),
      row('b.ts', 'staged'),
      row('c.ts', 'unstaged', { fileKind: 'conflicted', isConflicted: true })
    ])

    expect(groups.map((group) => group.kind)).toEqual(['conflicts', 'staged', 'unstaged'])
    expect(groups[0]?.rows.map((entry) => entry.file)).toEqual(['c.ts'])
  })

  it('omits groups with no rows', () => {
    const groups = buildStatusGroups([row('a.ts', 'unstaged')])

    expect(groups.map((group) => group.kind)).toEqual(['unstaged'])
  })

  it('returns no groups for a clean tree', () => {
    expect(buildStatusGroups([])).toEqual([])
  })

  // Fork lists a partially-staged file twice — once per side — so each row can be acted on and
  // diffed independently.
  it('lists a partially-staged file in both the staged and the unstaged group', () => {
    const groups = buildStatusGroups([row('a.ts', 'partial')])

    expect(groups.map((group) => group.kind)).toEqual(['staged', 'unstaged'])
    expect(groups[0]?.rows.map((entry) => entry.file)).toEqual(['a.ts'])
    expect(groups[1]?.rows.map((entry) => entry.file)).toEqual(['a.ts'])
  })

  it('keeps a conflicted file out of the staged and unstaged groups', () => {
    const groups = buildStatusGroups([
      row('a.ts', 'partial', { fileKind: 'conflicted', isConflicted: true })
    ])

    expect(groups.map((group) => group.kind)).toEqual(['conflicts'])
  })

  it('labels every group', () => {
    const groups = buildStatusGroups([
      row('a.ts', 'unstaged'),
      row('b.ts', 'staged'),
      row('c.ts', 'unstaged', { fileKind: 'conflicted', isConflicted: true })
    ])

    expect(groups.map((group) => group.label)).toEqual(['Conflicts', 'Staged', 'Unstaged'])
  })

  it('keeps the incoming row order inside a group', () => {
    const groups = buildStatusGroups([
      row('a.ts', 'unstaged'),
      row('b.ts', 'unstaged'),
      row('c.ts', 'unstaged')
    ])

    expect(groups[0]?.rows.map((entry) => entry.file)).toEqual(['a.ts', 'b.ts', 'c.ts'])
  })
})

describe('flattenStatusGroups', () => {
  it('tags every row with the group it renders in, in list order', () => {
    const groups = buildStatusGroups([
      row('a.ts', 'partial'),
      row('b.ts', 'unstaged', { fileKind: 'conflicted', isConflicted: true })
    ])

    expect(flattenStatusGroups(groups).map((entry) => `${entry.group}:${entry.row.file}`)).toEqual([
      'conflicts:b.ts',
      'staged:a.ts',
      'unstaged:a.ts'
    ])
  })
})

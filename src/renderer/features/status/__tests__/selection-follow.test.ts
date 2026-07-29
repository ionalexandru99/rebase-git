import { describe, expect, it } from 'vitest'
import { followSelection } from '@/features/status/selection-follow'
import type { FileStageState, UnifiedFileRow } from '@/features/status/status-file-rows'
import {
  buildStatusGroups,
  flattenStatusGroups,
  type StatusGroupKind
} from '@/features/status/status-groups'

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

const rowsOf = (...entries: UnifiedFileRow[]) => flattenStatusGroups(buildStatusGroups(entries))

const selection = (file: string, group: StatusGroupKind) => ({ file, group })

describe('followSelection', () => {
  it('keeps a selection whose row is still in the same group', () => {
    const rows = rowsOf(row('a.ts', 'unstaged'), row('b.ts', 'unstaged'))

    expect(
      followSelection({ selected: selection('a.ts', 'unstaged'), previous: rows, next: rows })
    ).toEqual({ kind: 'keep' })
  })

  it('selects the first row when nothing was selected yet', () => {
    const rows = rowsOf(row('b.ts', 'staged'), row('a.ts', 'unstaged'))

    expect(followSelection({ selected: null, previous: [], next: rows })).toEqual({
      kind: 'select',
      file: 'b.ts',
      renameSource: undefined,
      group: 'staged'
    })
  })

  it('follows the selected file into the group it moved to', () => {
    const previous = rowsOf(row('a.ts', 'unstaged'), row('b.ts', 'unstaged'))
    const next = rowsOf(row('a.ts', 'staged'), row('b.ts', 'unstaged'))

    expect(followSelection({ selected: selection('a.ts', 'unstaged'), previous, next })).toEqual({
      kind: 'select',
      file: 'a.ts',
      renameSource: undefined,
      group: 'staged'
    })
  })

  it('carries the rename source of the row it follows', () => {
    const previous = rowsOf(row('new.ts', 'unstaged'))
    const next = rowsOf(row('new.ts', 'staged', { renameSource: 'old.ts' }))

    expect(followSelection({ selected: selection('new.ts', 'unstaged'), previous, next })).toEqual({
      kind: 'select',
      file: 'new.ts',
      renameSource: 'old.ts',
      group: 'staged'
    })
  })

  // Staging one side of a partially-staged file leaves the other side listed, and the row the user
  // is looking at has not moved anywhere.
  it('keeps the selected side of a file that is listed in both groups', () => {
    const previous = rowsOf(row('a.ts', 'unstaged'))
    const next = rowsOf(row('a.ts', 'partial'))

    expect(followSelection({ selected: selection('a.ts', 'unstaged'), previous, next })).toEqual({
      kind: 'keep'
    })
  })

  it('selects the next row in the group a vanished file left', () => {
    const previous = rowsOf(
      row('a.ts', 'unstaged'),
      row('b.ts', 'unstaged'),
      row('c.ts', 'unstaged')
    )
    const next = rowsOf(row('a.ts', 'unstaged'), row('c.ts', 'unstaged'))

    expect(followSelection({ selected: selection('b.ts', 'unstaged'), previous, next })).toEqual({
      kind: 'select',
      file: 'c.ts',
      renameSource: undefined,
      group: 'unstaged'
    })
  })

  it('falls back to the row above when the vanished file was last in its group', () => {
    const previous = rowsOf(row('a.ts', 'unstaged'), row('b.ts', 'unstaged'))
    const next = rowsOf(row('a.ts', 'unstaged'))

    expect(followSelection({ selected: selection('b.ts', 'unstaged'), previous, next })).toEqual({
      kind: 'select',
      file: 'a.ts',
      renameSource: undefined,
      group: 'unstaged'
    })
  })

  it('leaves the emptied group for the first remaining row', () => {
    const previous = rowsOf(row('a.ts', 'unstaged'), row('b.ts', 'staged'))
    const next = rowsOf(row('b.ts', 'staged'))

    expect(followSelection({ selected: selection('a.ts', 'unstaged'), previous, next })).toEqual({
      kind: 'select',
      file: 'b.ts',
      renameSource: undefined,
      group: 'staged'
    })
  })

  it('clears the selection when the last change is gone', () => {
    const previous = rowsOf(row('a.ts', 'unstaged'))

    expect(
      followSelection({ selected: selection('a.ts', 'unstaged'), previous, next: [] })
    ).toEqual({ kind: 'clear' })
  })

  it('keeps an empty selection on an empty list', () => {
    expect(followSelection({ selected: null, previous: [], next: [] })).toEqual({ kind: 'keep' })
  })

  it('follows a resolved conflict out of the conflicts group', () => {
    const previous = rowsOf(row('a.ts', 'unstaged', { fileKind: 'conflicted', isConflicted: true }))
    const next = rowsOf(row('a.ts', 'staged'))

    expect(followSelection({ selected: selection('a.ts', 'conflicts'), previous, next })).toEqual({
      kind: 'select',
      file: 'a.ts',
      renameSource: undefined,
      group: 'staged'
    })
  })
})

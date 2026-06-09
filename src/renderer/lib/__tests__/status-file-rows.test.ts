import { describe, expect, it } from 'vitest'
import { buildUnifiedFileRows, type StatusFileKind } from '@/lib/status-file-rows'
import type { GitStatus } from '@/types'

type Code = { path: string; index: string; working_dir: string }

const status = (overrides: Partial<GitStatus> = {}): GitStatus => ({
  current: 'main',
  modified: [],
  staged: [],
  not_added: [],
  conflicted: [],
  deleted: [],
  created: [],
  renamed: [],
  files: [],
  ...overrides
})

const code = (path: string, index: string, working_dir: string): Code => ({
  path,
  index,
  working_dir
})

describe('buildUnifiedFileRows (porcelain codes)', () => {
  it('derives the stage state from index/working-tree codes', () => {
    const rows = buildUnifiedFileRows(
      status({
        files: [
          code('fully-staged.ts', 'M', ' '),
          code('partial.ts', 'M', 'M'),
          code('unstaged.ts', ' ', 'M'),
          code('new.ts', '?', '?'),
          code('added.ts', 'A', ' '),
          code('removed.ts', ' ', 'D')
        ]
      })
    )

    const byFile = Object.fromEntries(rows.map((row) => [row.file, row]))
    expect(byFile['fully-staged.ts'].stageState).toBe('staged')
    expect(byFile['partial.ts'].stageState).toBe('partial')
    expect(byFile['unstaged.ts'].stageState).toBe('unstaged')
    expect(byFile['new.ts'].stageState).toBe('unstaged')
    expect(byFile['new.ts'].isUntracked).toBe(true)
    expect(byFile['added.ts'].stageState).toBe('staged')
    expect(byFile['removed.ts'].stageState).toBe('unstaged')
  })

  it('maps codes to file kinds for the badge', () => {
    const rows = buildUnifiedFileRows(
      status({
        files: [
          code('a.ts', 'M', 'M'),
          code('b.ts', 'A', ' '),
          code('c.ts', ' ', 'D'),
          code('d.ts', '?', '?')
        ]
      })
    )
    const kinds = Object.fromEntries(rows.map((row) => [row.file, row.fileKind as StatusFileKind]))
    expect(kinds['a.ts']).toBe('modified')
    expect(kinds['b.ts']).toBe('created')
    expect(kinds['c.ts']).toBe('deleted')
    expect(kinds['d.ts']).toBe('untracked')
  })

  it('marks conflicted files and keeps them unstaged', () => {
    const rows = buildUnifiedFileRows(
      status({
        conflicted: ['merge.ts'],
        files: [code('merge.ts', 'U', 'U')]
      })
    )
    expect(rows[0].isConflicted).toBe(true)
    expect(rows[0].fileKind).toBe('conflicted')
    expect(rows[0].stageState).toBe('unstaged')
  })

  it('keeps a stable alphabetical order regardless of stage state', () => {
    const rows = buildUnifiedFileRows(
      status({
        files: [code('zebra.ts', 'M', ' '), code('apple.ts', ' ', 'M'), code('mango.ts', 'M', 'M')]
      })
    )
    expect(rows.map((row) => row.file)).toEqual(['apple.ts', 'mango.ts', 'zebra.ts'])
  })

  it('shows renamed files as "from → to"', () => {
    const rows = buildUnifiedFileRows(
      status({
        renamed: [{ from: 'old.ts', to: 'new.ts' }],
        files: [code('new.ts', 'R', ' ')]
      })
    )
    expect(rows[0].display).toBe('old.ts → new.ts')
    expect(rows[0].fileKind).toBe('renamed')
  })
})

describe('buildUnifiedFileRows (bucket fallback)', () => {
  it('derives rows from category arrays when files is empty', () => {
    const rows = buildUnifiedFileRows(
      status({
        staged: ['a.ts'],
        modified: ['a.ts', 'b.ts'],
        not_added: ['c.ts']
      })
    )
    const byFile = Object.fromEntries(rows.map((row) => [row.file, row]))
    expect(byFile['a.ts'].stageState).toBe('partial')
    expect(byFile['b.ts'].stageState).toBe('unstaged')
    expect(byFile['c.ts'].stageState).toBe('unstaged')
    expect(byFile['c.ts'].isUntracked).toBe(true)
  })
})

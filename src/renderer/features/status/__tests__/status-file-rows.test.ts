import { describe, expect, it } from 'vitest'
import {
  buildHeadCommitRows,
  buildStagedFilePaths,
  buildUnifiedFileRows,
  type StatusFileKind
} from '@/features/status/status-file-rows'
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
    expect(rows[0].renameSource).toBe('old.ts')
    expect(rows[0].fileKind).toBe('renamed')
  })
})

describe('buildHeadCommitRows', () => {
  it('maps last-commit files to head-commit rows carrying each file’s drop state', () => {
    const rows = buildHeadCommitRows(
      [
        { status: 'A', path: 'added.ts' },
        { status: 'M', path: 'mod.ts' },
        { status: 'D', path: 'gone.ts' },
        { status: 'R100', path: 'renamed.ts', renameSource: 'original.ts' }
      ],
      new Map<string, 'all' | ReadonlySet<string>>([
        ['mod.ts', 'all'],
        ['gone.ts', new Set(['@@ -1 +1 @@'])]
      ])
    )

    const byFile = Object.fromEntries(rows.map((row) => [row.file, row]))
    expect(byFile['added.ts']).toMatchObject({
      source: 'head-commit',
      fileKind: 'created',
      dropState: 'kept'
    })
    expect(byFile['mod.ts']).toMatchObject({
      source: 'head-commit',
      fileKind: 'modified',
      dropState: 'dropped'
    })
    expect(byFile['gone.ts']).toMatchObject({
      source: 'head-commit',
      fileKind: 'deleted',
      dropState: 'partial'
    })
    expect(byFile['renamed.ts']).toMatchObject({
      source: 'head-commit',
      fileKind: 'renamed',
      renameSource: 'original.ts'
    })
  })

  it('tags working-tree rows with the worktree source', () => {
    const rows = buildUnifiedFileRows(status({ files: [code('a.ts', 'M', ' ')] }))
    expect(rows[0].source).toBe('worktree')
  })
})

describe('buildStagedFilePaths', () => {
  it('includes both structured paths of a staged rename', () => {
    const rows = buildUnifiedFileRows(
      status({
        renamed: [{ from: 'old [source].ts', to: 'new *.ts' }],
        files: [code('new *.ts', 'R', ' ')]
      })
    )

    expect(buildStagedFilePaths(rows)).toEqual(['old [source].ts', 'new *.ts'])
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

  it('keeps rename source identity when the destination is also in staged', () => {
    const rows = buildUnifiedFileRows(
      status({
        staged: ['new.ts'],
        renamed: [{ from: 'old.ts', to: 'new.ts' }]
      })
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      file: 'new.ts',
      renameSource: 'old.ts',
      display: 'old.ts → new.ts',
      fileKind: 'renamed'
    })
  })
})

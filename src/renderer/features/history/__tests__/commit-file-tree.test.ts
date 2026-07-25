import type { CommitDetailFile } from '@shared/schemas/git'
import { describe, expect, it } from 'vitest'
import {
  buildCommitFileTreeRows,
  type CommitTreeRow,
  firstCommitTreeFile
} from '../commit-file-tree'

const file = (path: string, overrides: Partial<CommitDetailFile> = {}): CommitDetailFile => ({
  path,
  status: 'M',
  additions: 1,
  deletions: 1,
  binary: false,
  ...overrides
})

const NONE: ReadonlySet<string> = new Set()

const shape = (rows: readonly CommitTreeRow[]) =>
  rows.map(
    (row) => `${'  '.repeat(row.depth)}${row.kind === 'directory' ? `${row.label}/` : row.label}`
  )

describe('buildCommitFileTreeRows', () => {
  it('groups files under their directories, directories first then files', () => {
    const rows = buildCommitFileTreeRows(
      [file('README.md'), file('src/app.ts'), file('src/util.ts'), file('docs/guide.md')],
      NONE
    )

    expect(shape(rows)).toEqual([
      'docs/',
      '  guide.md',
      'src/',
      '  app.ts',
      '  util.ts',
      'README.md'
    ])
  })

  it('collapses a chain of single-child directories into one row', () => {
    const rows = buildCommitFileTreeRows([file('src/features/history/store.ts')], NONE)

    expect(shape(rows)).toEqual(['src/features/history/', '  store.ts'])
  })

  it('stops collapsing where a directory branches', () => {
    const rows = buildCommitFileTreeRows(
      [file('src/features/history/store.ts'), file('src/features/diff/panel.ts')],
      NONE
    )

    expect(shape(rows)).toEqual([
      'src/features/',
      '  diff/',
      '    panel.ts',
      '  history/',
      '    store.ts'
    ])
  })

  it('stops collapsing where a directory holds a file of its own', () => {
    const rows = buildCommitFileTreeRows([file('src/index.ts'), file('src/deep/leaf.ts')], NONE)

    expect(shape(rows)).toEqual(['src/', '  deep/', '    leaf.ts', '  index.ts'])
  })

  it('keys a collapsed chain by its deepest directory so the toggle survives a rebuild', () => {
    const rows = buildCommitFileTreeRows([file('a/b/c/leaf.ts')], NONE)

    expect(rows[0]).toMatchObject({ kind: 'directory', key: 'a/b/c', label: 'a/b/c' })
  })

  it('hides the contents of a collapsed directory but keeps the directory itself', () => {
    const files = [file('src/app.ts'), file('src/util.ts'), file('README.md')]

    const rows = buildCommitFileTreeRows(files, new Set(['src']))

    expect(shape(rows)).toEqual(['src/', 'README.md'])
    expect(rows[0]).toMatchObject({ collapsed: true })
  })

  it('hides nested directories along with their parent', () => {
    const files = [file('src/deep/leaf.ts'), file('src/index.ts')]

    expect(shape(buildCommitFileTreeRows(files, new Set(['src'])))).toEqual(['src/'])
  })

  it('counts every file beneath a directory, however deep', () => {
    const rows = buildCommitFileTreeRows(
      [file('src/a.ts'), file('src/deep/b.ts'), file('src/deep/deeper/c.ts')],
      new Set(['src'])
    )

    expect(rows[0]).toMatchObject({ kind: 'directory', key: 'src', fileCount: 3 })
  })

  it('labels a file by its own name, not its whole path', () => {
    const rows = buildCommitFileTreeRows([file('src/deep/leaf.ts')], NONE)

    expect(rows.at(-1)).toMatchObject({ kind: 'file', key: 'src/deep/leaf.ts', label: 'leaf.ts' })
  })

  it('shows a rename within one directory as name → name', () => {
    const rows = buildCommitFileTreeRows(
      [file('src/after.ts', { status: 'R', oldPath: 'src/before.ts' })],
      NONE
    )

    expect(rows.at(-1)).toMatchObject({ label: 'before.ts → after.ts' })
  })

  it('shows a rename across directories with the full old path', () => {
    const rows = buildCommitFileTreeRows(
      [file('src/after.ts', { status: 'R', oldPath: 'legacy/before.ts' })],
      NONE
    )

    expect(rows.at(-1)).toMatchObject({ label: 'legacy/before.ts → after.ts' })
  })

  it('returns nothing for a commit that touches no files', () => {
    expect(buildCommitFileTreeRows([], NONE)).toEqual([])
  })

  it('keeps directory and file names that contain unusual characters intact', () => {
    const rows = buildCommitFileTreeRows([file('we ird/a b.txt')], NONE)

    expect(shape(rows)).toEqual(['we ird/', '  a b.txt'])
  })
})

describe('firstCommitTreeFile', () => {
  it('picks the file that reads first in tree order, not in path order', () => {
    const files = [file('README.md'), file('src/app.ts')]

    expect(firstCommitTreeFile(files)?.path).toBe('src/app.ts')
  })

  it('picks a root file when there are no directories', () => {
    expect(firstCommitTreeFile([file('b.txt'), file('a.txt')])?.path).toBe('a.txt')
  })

  it('returns undefined for an empty commit', () => {
    expect(firstCommitTreeFile([])).toBeUndefined()
  })
})

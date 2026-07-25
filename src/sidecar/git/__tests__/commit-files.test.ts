import { describe, expect, it } from 'vitest'
import { buildCommitFiles, parseCommitNameStatus, parseCommitNumstat } from '../commit-files'

const NUL = '\x00'
const record = (...fields: string[]) => fields.map((field) => `${field}${NUL}`).join('')

describe('parseCommitNameStatus', () => {
  it('reads one path per add, modify and delete record', () => {
    const output = record('D', 'del.txt', 'A', 'new.txt', 'M', 'one.txt')

    expect(parseCommitNameStatus(output)).toEqual([
      { status: 'D', path: 'del.txt' },
      { status: 'A', path: 'new.txt' },
      { status: 'M', path: 'one.txt' }
    ])
  })

  it('reads two paths for a rename and keeps the source as oldPath', () => {
    const output = record('R100', 'blob.bin', 'renamed.bin')

    expect(parseCommitNameStatus(output)).toEqual([
      { status: 'R', path: 'renamed.bin', oldPath: 'blob.bin' }
    ])
  })

  it('reports a copy as a rename so the panel has an old and a new path', () => {
    const output = record('C75', 'template.ts', 'copy.ts')

    expect(parseCommitNameStatus(output)).toEqual([
      { status: 'R', path: 'copy.ts', oldPath: 'template.ts' }
    ])
  })

  it('folds a type change into a modification', () => {
    expect(parseCommitNameStatus(record('T', 'link'))).toEqual([{ status: 'M', path: 'link' }])
  })

  it('returns nothing for an empty commit', () => {
    expect(parseCommitNameStatus('')).toEqual([])
  })

  it('keeps paths that contain tabs and newlines intact', () => {
    const output = record('M', 'weird\tname\nfile.txt')

    expect(parseCommitNameStatus(output)).toEqual([{ status: 'M', path: 'weird\tname\nfile.txt' }])
  })
})

describe('parseCommitNumstat', () => {
  it('reads added and deleted line counts per path', () => {
    const output = record('0\t1\tdel.txt', '1\t0\tnew.txt', '12\t3\tone.txt')

    expect(parseCommitNumstat(output)).toEqual([
      { path: 'del.txt', additions: 0, deletions: 1, binary: false },
      { path: 'new.txt', additions: 1, deletions: 0, binary: false },
      { path: 'one.txt', additions: 12, deletions: 3, binary: false }
    ])
  })

  it('flags a binary file, which git reports with dashes instead of counts', () => {
    const output = record('-\t-\tlogo.png')

    expect(parseCommitNumstat(output)).toEqual([
      { path: 'logo.png', additions: 0, deletions: 0, binary: true }
    ])
  })

  it('takes the destination path of a rename, whose counts precede two path fields', () => {
    const output = record('-\t-\t', 'blob.bin', 'renamed.bin', '1\t1\tafter.txt')

    expect(parseCommitNumstat(output)).toEqual([
      { path: 'renamed.bin', additions: 0, deletions: 0, binary: true },
      { path: 'after.txt', additions: 1, deletions: 1, binary: false }
    ])
  })
})

describe('buildCommitFiles', () => {
  it('joins statuses with their line counts and sorts by path', () => {
    const nameStatus = parseCommitNameStatus(record('M', 'src/one.ts', 'A', 'a/new.ts'))
    const numstat = parseCommitNumstat(record('4\t2\tsrc/one.ts', '9\t0\ta/new.ts'))

    expect(buildCommitFiles(nameStatus, numstat)).toEqual([
      { path: 'a/new.ts', status: 'A', additions: 9, deletions: 0, binary: false },
      { path: 'src/one.ts', status: 'M', additions: 4, deletions: 2, binary: false }
    ])
  })

  it('carries oldPath and the binary flag through for a renamed binary', () => {
    const nameStatus = parseCommitNameStatus(record('R100', 'blob.bin', 'renamed.bin'))
    const numstat = parseCommitNumstat(record('-\t-\t', 'blob.bin', 'renamed.bin'))

    expect(buildCommitFiles(nameStatus, numstat)).toEqual([
      {
        path: 'renamed.bin',
        status: 'R',
        additions: 0,
        deletions: 0,
        binary: true,
        oldPath: 'blob.bin'
      }
    ])
  })

  it('falls back to zero counts when numstat has no row for a path', () => {
    const nameStatus = parseCommitNameStatus(record('M', 'mode-only.sh'))

    expect(buildCommitFiles(nameStatus, [])).toEqual([
      { path: 'mode-only.sh', status: 'M', additions: 0, deletions: 0, binary: false }
    ])
  })
})

import { describe, expect, it } from 'vitest'
import { FS_SEP, parseGitLogOutput, RS_SEP } from '../log-format'

function makeRawLog(count: number): string {
  return Array.from({ length: count }, (_, index) => {
    const n = index + 1
    return [
      `hash-${n}`,
      n === 1 ? '' : `hash-${n - 1}`,
      '2026-01-01T00:00:00Z',
      'Test',
      `commit ${n}`,
      ''
    ].join(FS_SEP)
  }).join(RS_SEP)
}

describe('git log format parser', () => {
  it('parses histories beyond the old 1000-entry cap', () => {
    const count = 1005
    const commits = parseGitLogOutput(makeRawLog(count))

    expect(commits).toHaveLength(count)
    expect(commits[0]).toMatchObject({ hash: 'hash-1', message: 'commit 1', parents: [] })
    expect(commits[count - 1]).toMatchObject({
      hash: `hash-${count}`,
      message: `commit ${count}`,
      parents: [`hash-${count - 1}`]
    })
  })

  it('uses a configurable fixture size for small parser checks', () => {
    const count = 10
    expect(parseGitLogOutput(makeRawLog(count))).toHaveLength(count)
  })
})

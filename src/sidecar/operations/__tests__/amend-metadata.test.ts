import { describe, expect, it } from 'vitest'
import {
  parseAmendDiffSummary,
  parseAmendHeadCommit,
  parseAmendNameStatus,
  stripTrailingNewlines
} from '../amend-metadata'

describe('amend metadata', () => {
  it('parses the commit identity and all parents', () => {
    const head = parseAmendHeadCommit(
      'commit\x00parent-one parent-two\x00Jane Doe\x00jane@example.com\x002026-08-02T09:00:00Z\n'
    )

    expect(head).toEqual({
      sha: 'commit',
      parents: ['parent-one', 'parent-two'],
      authorName: 'Jane Doe',
      authorEmail: 'jane@example.com',
      authorDate: '2026-08-02T09:00:00Z'
    })
  })

  it('parses a parentless root commit', () => {
    const head = parseAmendHeadCommit(
      'root\x00\x00Jane Doe\x00jane@example.com\x002026-08-02T09:00:00Z\n'
    )

    expect(head.parents).toEqual([])
  })

  it('rejects truncated or empty commit metadata', () => {
    expect(() => parseAmendHeadCommit('commit\x00parent\x00Jane Doe')).toThrow(
      'Invalid amend HEAD metadata'
    )
    expect(() =>
      parseAmendHeadCommit('commit\x00parent\x00\x00jane@example.com\x002026-08-02T09:00:00Z\n')
    ).toThrow('Invalid amend HEAD metadata')
    expect(() =>
      parseAmendHeadCommit('commit\x00parent\x00   \x00jane@example.com\x002026-08-02T09:00:00Z\n')
    ).toThrow('Invalid amend HEAD metadata')
  })

  it('parses modified, renamed, and copied paths from NUL-delimited output', () => {
    const files = parseAmendNameStatus(
      'M\x00changed.txt\x00R100\x00before.txt\x00after.txt\x00C075\x00source.txt\x00copy.txt\x00'
    )

    expect(files).toEqual([
      { status: 'M', path: 'changed.txt' },
      { status: 'R100', path: 'after.txt', renameSource: 'before.txt' },
      { status: 'C075', path: 'copy.txt' }
    ])
  })

  it('returns no files for empty name-status output', () => {
    expect(parseAmendNameStatus('')).toEqual([])
  })

  it('rejects truncated name-status records', () => {
    expect(() => parseAmendNameStatus('M\x00changed.txt')).toThrow(
      'Invalid amend name-status output'
    )
    expect(() => parseAmendNameStatus('M\x00')).toThrow('Invalid amend name-status output')
    expect(() => parseAmendNameStatus('R100\x00before.txt\x00')).toThrow(
      'Invalid amend name-status output'
    )
  })

  it('summarizes text and binary numstat entries', () => {
    const summary = parseAmendDiffSummary(
      '12\t3\ttext.txt\n-\t-\timage.png\ninvalid\t2\tother.txt\n'
    )

    expect(summary).toEqual({ changes: 3, insertions: 12, deletions: 5 })
  })

  it('returns an empty summary for empty numstat output', () => {
    expect(parseAmendDiffSummary('')).toEqual({ changes: 0, insertions: 0, deletions: 0 })
  })

  it('removes only trailing newlines from a commit message', () => {
    expect(stripTrailingNewlines('subject\n\nbody\n\n')).toBe('subject\n\nbody')
  })
})

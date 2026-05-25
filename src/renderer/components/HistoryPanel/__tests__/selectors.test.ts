import { describe, expect, it } from 'vitest'
import type { GitLogEntry } from '@/types'
import { computeBranchFilterSet, expandFilterRefs, findRefTip, refFilterKey } from '../selectors'

function entry(overrides: Partial<GitLogEntry> & Pick<GitLogEntry, 'hash'>): GitLogEntry {
  return {
    message: 'msg',
    author_name: 'Author',
    date: new Date().toISOString(),
    parents: [],
    refs: '',
    ...overrides
  }
}

describe('refFilterKey', () => {
  it('encodes kind and full path', () => {
    expect(refFilterKey('local', 'feature')).toBe('local:feature')
    expect(refFilterKey('remote', 'origin/feature')).toBe('remote:origin/feature')
  })
})

describe('findRefTip', () => {
  const remoteNames = new Set(['origin'])

  it('finds a local branch tip from refs', () => {
    const commits = [entry({ hash: 'tip', refs: 'HEAD -> main' })]
    expect(findRefTip(commits, 'local', 'main', remoteNames)).toBe('tip')
  })

  it('finds a remote branch tip from refs', () => {
    const commits = [entry({ hash: 'rtip', refs: 'origin/feature' })]
    expect(findRefTip(commits, 'remote', 'origin/feature', remoteNames)).toBe('rtip')
  })

  it('returns undefined when the ref is not in the log', () => {
    const commits = [entry({ hash: 'a', refs: 'main' })]
    expect(findRefTip(commits, 'local', 'missing', remoteNames)).toBeUndefined()
  })
})

describe('expandFilterRefs', () => {
  const remotes = ['origin/main', 'origin/feature', 'upstream/feature']

  it('includes origin tracking remote for a selected local branch', () => {
    const selected = new Set([refFilterKey('local', 'feature')])
    const expanded = expandFilterRefs(selected, remotes)
    expect(expanded).toEqual([
      { kind: 'local', fullPath: 'feature' },
      { kind: 'remote', fullPath: 'origin/feature' }
    ])
  })

  it('does not auto-add a local branch for remote-only selection', () => {
    const selected = new Set([refFilterKey('remote', 'origin/feature')])
    const expanded = expandFilterRefs(selected, remotes)
    expect(expanded).toEqual([{ kind: 'remote', fullPath: 'origin/feature' }])
  })

  it('skips tags', () => {
    const selected = new Set([refFilterKey('tag', 'v1.0')])
    expect(expandFilterRefs(selected, remotes)).toEqual([])
  })
})

describe('computeBranchFilterSet', () => {
  const remoteNames = new Set(['origin'])
  const remotes = ['origin/feature', 'origin/main']

  it('returns null for empty selection', () => {
    expect(computeBranchFilterSet([], new Set(), remotes, remoteNames)).toBeNull()
    expect(computeBranchFilterSet([], undefined, remotes, remoteNames)).toBeNull()
  })

  it('walks ancestry from local branch and origin tips', () => {
    const commits = [
      entry({ hash: 'f1', refs: 'feature, origin/feature', parents: ['base'] }),
      entry({ hash: 'base', refs: '', parents: [] })
    ]
    const selected = new Set([refFilterKey('local', 'feature')])
    const result = computeBranchFilterSet(commits, selected, remotes, remoteNames)
    expect(result).toEqual(new Set(['f1', 'base']))
  })

  it('unions ancestry from multiple selected branches', () => {
    const commits = [
      entry({ hash: 'a1', refs: 'alpha', parents: ['shared'] }),
      entry({ hash: 'b1', refs: 'beta', parents: ['shared'] }),
      entry({ hash: 'shared', refs: '', parents: [] })
    ]
    const selected = new Set([refFilterKey('local', 'alpha'), refFilterKey('local', 'beta')])
    const result = computeBranchFilterSet(commits, selected, [], remoteNames)
    expect(result).toEqual(new Set(['a1', 'b1', 'shared']))
  })

  it('returns empty set when no tips resolve', () => {
    const selected = new Set([refFilterKey('local', 'missing')])
    const result = computeBranchFilterSet([], selected, remotes, remoteNames)
    expect(result).toEqual(new Set())
  })
})

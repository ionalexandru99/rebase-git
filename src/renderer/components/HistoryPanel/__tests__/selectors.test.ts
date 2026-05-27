import { describe, expect, it } from 'vitest'
import type { GitLogEntry } from '@/types'
import {
  computeBranchFilterSet,
  computeOnBranchSet,
  countVisibleBranchRefs,
  expandFilterRefs,
  findRefTip,
  pruneAncestorTips,
  refFilterKey,
  resolveTrackingRemoteBranches
} from '../selectors'

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
})

describe('expandFilterRefs', () => {
  it('returns only explicitly selected refs', () => {
    const selected = new Set([
      refFilterKey('local', 'feature'),
      refFilterKey('remote', 'origin/main')
    ])
    expect(expandFilterRefs(selected)).toEqual([
      { kind: 'local', fullPath: 'feature' },
      { kind: 'remote', fullPath: 'origin/main' }
    ])
  })
})

describe('pruneAncestorTips', () => {
  it('drops tips that are strict ancestors of another selected tip', () => {
    const commits = [
      entry({ hash: 'main-tip', refs: 'main', parents: ['feature-tip'] }),
      entry({ hash: 'feature-tip', refs: 'feature', parents: ['shared'] }),
      entry({ hash: 'shared', refs: '', parents: [] })
    ]
    expect(pruneAncestorTips(commits, ['main-tip', 'feature-tip'])).toEqual(['main-tip'])
  })
})

describe('computeBranchFilterSet', () => {
  const remoteNames = new Set(['origin'])
  const remotes = ['origin/feature', 'origin/main']

  it('returns null for empty selection', () => {
    expect(computeBranchFilterSet([], new Set(), remotes, remoteNames)).toBeNull()
  })

  it('does not add commits when a selected branch is already contained in main', () => {
    const commits = [
      entry({ hash: 'main-tip', refs: 'main, origin/main', parents: ['feature-tip'] }),
      entry({ hash: 'feature-tip', refs: 'feature', parents: ['shared'] }),
      entry({ hash: 'shared', refs: '', parents: [] })
    ]
    const mainOnly = computeBranchFilterSet(
      commits,
      new Set([refFilterKey('local', 'main'), refFilterKey('remote', 'origin/main')]),
      remotes,
      remoteNames
    )
    const withFeature = computeBranchFilterSet(
      commits,
      new Set([
        refFilterKey('local', 'main'),
        refFilterKey('remote', 'origin/main'),
        refFilterKey('local', 'feature')
      ]),
      remotes,
      remoteNames
    )
    expect(withFeature).toEqual(mainOnly)
  })

  it('does not pull in a diverged tracking remote for a local branch', () => {
    const commits = [
      entry({ hash: 'remote-tip', refs: 'origin/feature', parents: ['remote-only'] }),
      entry({ hash: 'remote-only', refs: '', parents: ['shared'] }),
      entry({ hash: 'local-tip', refs: 'feature', parents: ['shared'] }),
      entry({ hash: 'shared', refs: 'main', parents: [] })
    ]
    const selected = new Set([refFilterKey('local', 'feature')])
    const result = computeBranchFilterSet(commits, selected, remotes, remoteNames)
    expect(result).toEqual(new Set(['local-tip', 'shared']))
  })

  it('includes a tracking remote at the same commit as the local branch', () => {
    const commits = [
      entry({ hash: 'tip', refs: 'main, origin/main', parents: ['base'] }),
      entry({ hash: 'base', refs: '', parents: [] })
    ]
    const selected = new Set([refFilterKey('local', 'main')])
    const result = computeBranchFilterSet(commits, selected, remotes, remoteNames)
    expect(result).toEqual(new Set(['tip', 'base']))
  })

  it('unions unique commits from branches that diverge', () => {
    const commits = [
      entry({ hash: 'a1', refs: 'alpha', parents: ['shared'] }),
      entry({ hash: 'b1', refs: 'beta', parents: ['shared'] }),
      entry({ hash: 'shared', refs: '', parents: [] })
    ]
    const selected = new Set([refFilterKey('local', 'alpha'), refFilterKey('local', 'beta')])
    const result = computeBranchFilterSet(commits, selected, [], remoteNames)
    expect(result).toEqual(new Set(['a1', 'b1', 'shared']))
  })
})

describe('countVisibleBranchRefs', () => {
  it('counts a selected local branch and its tracking remote as one branch', () => {
    const selected = new Set([
      refFilterKey('local', 'main'),
      refFilterKey('remote', 'origin/main'),
      refFilterKey('local', 'feature')
    ])
    expect(countVisibleBranchRefs(selected, ['origin/main'], new Set(['origin']))).toBe(2)
  })

  it('counts remote-only selections as visible branches', () => {
    const selected = new Set([refFilterKey('remote', 'origin/feature')])
    expect(countVisibleBranchRefs(selected, ['origin/feature'], new Set(['origin']))).toBe(1)
  })
})

describe('computeOnBranchSet', () => {
  it('returns commits reachable from HEAD on the current branch', () => {
    const commits = [
      entry({ hash: 'feature-tip', refs: 'feature', parents: ['base'] }),
      entry({ hash: 'main-tip', refs: 'HEAD -> main', parents: ['base'] }),
      entry({ hash: 'base', refs: '', parents: [] })
    ]
    expect(computeOnBranchSet(commits, new Set(['origin']), 'main')).toEqual(
      new Set(['main-tip', 'base'])
    )
  })
})

describe('resolveTrackingRemoteBranches', () => {
  it('lists origin and other remotes for a local branch name', () => {
    const remotes = ['origin/main', 'upstream/main']
    expect(resolveTrackingRemoteBranches('main', remotes, new Set(['origin', 'upstream']))).toEqual(
      ['origin/main', 'upstream/main']
    )
  })
})

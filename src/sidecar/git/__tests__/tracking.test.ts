import { describe, expect, it } from 'vitest'
import { parseLocalBranchRefs, parseRemoteAndTagRefs } from '../tracking'

const SEP = '\x00'

function localLine(name: string, head: ' ' | '*' = ' ', track = '', committerDate = ''): string {
  return `${name}${SEP}${head}${SEP}${track}${SEP}${committerDate}`
}

describe('parseLocalBranchRefs', () => {
  it('lists branches and marks the checked-out one as current', () => {
    const raw = [localLine('dev'), localLine('main', '*'), ''].join('\n')
    expect(parseLocalBranchRefs(raw)).toEqual({
      current: 'main',
      all: ['dev', 'main'],
      tracking: {},
      lastCommitAt: {}
    })
  })

  it('reads each branch tip committer date', () => {
    const raw = [
      localLine('main', '*', '', '2021-01-02T03:04:05+00:00'),
      localLine('feature', ' ', '', '2022-06-07T08:09:10+00:00'),
      ''
    ].join('\n')
    expect(parseLocalBranchRefs(raw).lastCommitAt).toEqual({
      main: '2021-01-02T03:04:05+00:00',
      feature: '2022-06-07T08:09:10+00:00'
    })
  })

  it('returns an empty current on detached HEAD', () => {
    const raw = [localLine('main'), ''].join('\n')
    expect(parseLocalBranchRefs(raw).current).toBe('')
  })

  it('parses both ahead and behind on the same branch', () => {
    const raw = [localLine('main', '*', '[ahead 2, behind 1]'), ''].join('\n')
    expect(parseLocalBranchRefs(raw).tracking).toEqual({ main: { ahead: 2, behind: 1 } })
  })

  it('parses ahead-only and behind-only', () => {
    const raw = [
      localLine('feature/foo', ' ', '[ahead 5]'),
      localLine('develop', ' ', '[behind 3]'),
      ''
    ].join('\n')
    expect(parseLocalBranchRefs(raw).tracking).toEqual({
      'feature/foo': { ahead: 5, behind: 0 },
      develop: { ahead: 0, behind: 3 }
    })
  })

  it('omits branches in sync with their upstream', () => {
    const raw = [localLine('main', '*'), localLine('clean', ' ', '[ahead 0]'), ''].join('\n')
    expect(parseLocalBranchRefs(raw).tracking).toEqual({})
  })

  it('omits branches whose upstream is gone', () => {
    const raw = [localLine('orphan', ' ', '[gone]'), ''].join('\n')
    expect(parseLocalBranchRefs(raw).tracking).toEqual({})
  })

  it('handles blank lines and empty output', () => {
    expect(parseLocalBranchRefs('')).toEqual({
      current: '',
      all: [],
      tracking: {},
      lastCommitAt: {}
    })
    const raw = [
      '',
      localLine('main', '*', '[ahead 2]'),
      '',
      localLine('feature', ' ', '[behind 1]'),
      ''
    ].join('\n')
    expect(parseLocalBranchRefs(raw)).toEqual({
      current: 'main',
      all: ['main', 'feature'],
      tracking: {
        main: { ahead: 2, behind: 0 },
        feature: { ahead: 0, behind: 1 }
      },
      lastCommitAt: {}
    })
  })

  it('keeps branch names that contain slashes intact', () => {
    const raw = [localLine('feature/a/b/c', ' ', '[ahead 4, behind 2]'), ''].join('\n')
    expect(parseLocalBranchRefs(raw)).toEqual({
      current: '',
      all: ['feature/a/b/c'],
      tracking: { 'feature/a/b/c': { ahead: 4, behind: 2 } },
      lastCommitAt: {}
    })
  })
})

function remoteOrTagLine(refname: string, symref = '', committerDate = '', peeled = ''): string {
  return `${refname}${SEP}${symref}${SEP}${committerDate}${SEP}${peeled}`
}

describe('parseRemoteAndTagRefs', () => {
  it('splits remote branches and tags by ref prefix', () => {
    const raw = [
      remoteOrTagLine('refs/remotes/origin/feature'),
      remoteOrTagLine('refs/remotes/origin/main'),
      remoteOrTagLine('refs/tags/v1'),
      remoteOrTagLine('refs/tags/v2'),
      ''
    ].join('\n')
    expect(parseRemoteAndTagRefs(raw)).toEqual({
      remotes: ['origin/feature', 'origin/main'],
      tags: ['v1', 'v2'],
      remoteLastCommitAt: {},
      tagLastCommitAt: {}
    })
  })

  it('reads each remote branch tip committer date', () => {
    const raw = [
      remoteOrTagLine('refs/remotes/origin/main', '', '2021-01-02T03:04:05+00:00'),
      remoteOrTagLine('refs/remotes/origin/feature', '', '2022-06-07T08:09:10+00:00'),
      ''
    ].join('\n')
    expect(parseRemoteAndTagRefs(raw).remoteLastCommitAt).toEqual({
      'origin/main': '2021-01-02T03:04:05+00:00',
      'origin/feature': '2022-06-07T08:09:10+00:00'
    })
  })

  it('prefers the peeled committer date so annotated tags report their target commit', () => {
    const raw = [
      remoteOrTagLine('refs/tags/light', '', '2021-01-02T03:04:05+00:00'),
      remoteOrTagLine('refs/tags/annotated', '', '', '2020-03-04T05:06:07+00:00'),
      ''
    ].join('\n')
    expect(parseRemoteAndTagRefs(raw).tagLastCommitAt).toEqual({
      light: '2021-01-02T03:04:05+00:00',
      annotated: '2020-03-04T05:06:07+00:00'
    })
  })

  it('skips symbolic refs like origin/HEAD', () => {
    const raw = [
      remoteOrTagLine('refs/remotes/origin/HEAD', 'refs/remotes/origin/main'),
      remoteOrTagLine('refs/remotes/origin/main'),
      ''
    ].join('\n')
    expect(parseRemoteAndTagRefs(raw)).toEqual({
      remotes: ['origin/main'],
      tags: [],
      remoteLastCommitAt: {},
      tagLastCommitAt: {}
    })
  })

  it('keeps remote branch names that contain slashes intact', () => {
    const raw = [remoteOrTagLine('refs/remotes/upstream/feature/a/b'), ''].join('\n')
    expect(parseRemoteAndTagRefs(raw)).toEqual({
      remotes: ['upstream/feature/a/b'],
      tags: [],
      remoteLastCommitAt: {},
      tagLastCommitAt: {}
    })
  })

  it('returns empty lists for empty output', () => {
    expect(parseRemoteAndTagRefs('')).toEqual({
      remotes: [],
      tags: [],
      remoteLastCommitAt: {},
      tagLastCommitAt: {}
    })
  })
})

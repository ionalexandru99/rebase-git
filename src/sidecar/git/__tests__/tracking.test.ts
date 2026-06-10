import { describe, expect, it } from 'vitest'
import { parseLocalBranchRefs, parseRemoteAndTagRefs } from '../tracking'

const SEP = '\x00'

function localLine(name: string, head: ' ' | '*' = ' ', track = ''): string {
  return `${name}${SEP}${head}${SEP}${track}`
}

describe('parseLocalBranchRefs', () => {
  it('lists branches and marks the checked-out one as current', () => {
    const raw = [localLine('dev'), localLine('main', '*'), ''].join('\n')
    expect(parseLocalBranchRefs(raw)).toEqual({
      current: 'main',
      all: ['dev', 'main'],
      tracking: {}
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
    expect(parseLocalBranchRefs('')).toEqual({ current: '', all: [], tracking: {} })
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
      }
    })
  })

  it('keeps branch names that contain slashes intact', () => {
    const raw = [localLine('feature/a/b/c', ' ', '[ahead 4, behind 2]'), ''].join('\n')
    expect(parseLocalBranchRefs(raw)).toEqual({
      current: '',
      all: ['feature/a/b/c'],
      tracking: { 'feature/a/b/c': { ahead: 4, behind: 2 } }
    })
  })
})

describe('parseRemoteAndTagRefs', () => {
  it('splits remote branches and tags by ref prefix', () => {
    const raw = [
      `refs/remotes/origin/feature${SEP}`,
      `refs/remotes/origin/main${SEP}`,
      `refs/tags/v1${SEP}`,
      `refs/tags/v2${SEP}`,
      ''
    ].join('\n')
    expect(parseRemoteAndTagRefs(raw)).toEqual({
      remotes: ['origin/feature', 'origin/main'],
      tags: ['v1', 'v2']
    })
  })

  it('skips symbolic refs like origin/HEAD', () => {
    const raw = [
      `refs/remotes/origin/HEAD${SEP}refs/remotes/origin/main`,
      `refs/remotes/origin/main${SEP}`,
      ''
    ].join('\n')
    expect(parseRemoteAndTagRefs(raw)).toEqual({ remotes: ['origin/main'], tags: [] })
  })

  it('keeps remote branch names that contain slashes intact', () => {
    const raw = [`refs/remotes/upstream/feature/a/b${SEP}`, ''].join('\n')
    expect(parseRemoteAndTagRefs(raw)).toEqual({ remotes: ['upstream/feature/a/b'], tags: [] })
  })

  it('returns empty lists for empty output', () => {
    expect(parseRemoteAndTagRefs('')).toEqual({ remotes: [], tags: [] })
  })
})

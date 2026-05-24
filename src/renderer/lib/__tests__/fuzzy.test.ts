import { describe, expect, it } from 'vitest'
import { fuzzyFilter, fuzzyMatchSet } from '@/lib/fuzzy'

describe('fuzzyFilter', () => {
  it('returns all items unchanged for an empty query', () => {
    const items = ['/a', '/b', '/c']
    expect(fuzzyFilter('  ', items)).toEqual(items)
  })

  it('keeps only fuzzy-matching items', () => {
    const result = fuzzyFilter('rebase', [
      '/home/aion/rebase-git',
      '/tmp/other',
      '/work/rebase-clone'
    ])
    expect(result).toContain('/home/aion/rebase-git')
    expect(result).toContain('/work/rebase-clone')
    expect(result).not.toContain('/tmp/other')
  })

  it('ranks closer matches ahead of looser ones', () => {
    const [best] = fuzzyFilter('rebase', ['/x/re-ba-se-scattered', '/x/rebase'])
    expect(best).toBe('/x/rebase')
  })
})

interface Commit {
  hash: string
  message: string
  author_name: string
  refs: string
}

const commit = (overrides: Partial<Commit> & Pick<Commit, 'hash'>): Commit => ({
  message: '',
  author_name: '',
  refs: '',
  ...overrides
})

describe('fuzzyMatchSet', () => {
  const commits: Commit[] = [
    commit({ hash: 'abc123', message: 'Add sparse checkout', author_name: 'Jane' }),
    commit({
      hash: 'def456',
      message: 'Fix commit panel',
      author_name: 'Alex',
      refs: 'origin/main'
    })
  ]
  const keys = ['message', 'hash', 'author_name', 'refs'] as const

  it('returns null for an empty query (no dimming)', () => {
    expect(fuzzyMatchSet('', commits, keys, (c) => c.hash)).toBeNull()
  })

  it('matches across any of the keys', () => {
    expect(fuzzyMatchSet('sparse', commits, keys, (c) => c.hash)).toEqual(new Set(['abc123']))
    expect(fuzzyMatchSet('Alex', commits, keys, (c) => c.hash)).toEqual(new Set(['def456']))
    expect(fuzzyMatchSet('origin', commits, keys, (c) => c.hash)).toEqual(new Set(['def456']))
  })
})

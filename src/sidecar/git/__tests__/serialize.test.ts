import { describe, expect, it } from 'vitest'
import { partitionBranchNames, serializeLocalBranches } from '../serialize'

describe('partitionBranchNames', () => {
  it('splits local and remote-tracking refs from a combined branch list', () => {
    expect(
      partitionBranchNames([
        'main',
        'develop',
        'remotes/origin/main',
        'remotes/origin/develop',
        'remotes/origin/HEAD -> origin/main'
      ])
    ).toEqual({
      local: ['main', 'develop'],
      remotes: ['origin/main', 'origin/develop']
    })
  })
})

describe('serializeLocalBranches', () => {
  it('returns only local branch names', () => {
    const result = serializeLocalBranches({
      current: 'main',
      all: ['main', 'feature', 'remotes/origin/main'],
      branches: {},
      detached: false
    } as Awaited<ReturnType<ReturnType<typeof import('simple-git').simpleGit>['branch']>>)
    expect(result).toEqual({
      current: 'main',
      all: ['main', 'feature'],
      tracking: undefined
    })
  })
})

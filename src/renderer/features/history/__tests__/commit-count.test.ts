import { describe, expect, it } from 'vitest'
import { commitCountLabel } from '../commit-count'

describe('commitCountLabel', () => {
  it('names the repository timeline before any commit has loaded', () => {
    expect(commitCountLabel({ loadedCount: 0, visibleTotal: 0, visibleBranchCount: 0 })).toBe(
      'Repository timeline'
    )
  })

  it('uses singular copy for one commit on one branch', () => {
    expect(commitCountLabel({ loadedCount: 1, visibleTotal: 1, visibleBranchCount: 1 })).toBe(
      '1 commit · 1 branch visible'
    )
  })

  it('pluralises commits and branches', () => {
    expect(commitCountLabel({ loadedCount: 3, visibleTotal: 3, visibleBranchCount: 2 })).toBe(
      '3 commits · 2 branches visible'
    )
  })

  it('says when no branch is visible', () => {
    expect(commitCountLabel({ loadedCount: 2, visibleTotal: 0, visibleBranchCount: 0 })).toBe(
      '0 commits · no branches visible'
    )
  })

  it('reports what is loaded and that more is available', () => {
    expect(
      commitCountLabel({ loadedCount: 2, visibleTotal: 2, visibleBranchCount: 1, hasMore: true })
    ).toBe('2 commits · 1 branch visible · 2 loaded · more available')
  })
})

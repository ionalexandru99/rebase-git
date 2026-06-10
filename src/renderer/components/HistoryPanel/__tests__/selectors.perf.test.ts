import { describe, expect, it } from 'vitest'
import type { GitLogEntry } from '@/types'
import { computeBranchFilterSet, computeOnBranchSet, refFilterKey } from '../selectors'

const COMMIT_COUNT = 20_000
const BRANCH_COUNT = 40

function buildHistory(): GitLogEntry[] {
  return Array.from({ length: COMMIT_COUNT }, (_unused, index) => {
    const branch = index < BRANCH_COUNT ? `branch-${index}` : null
    return {
      hash: `commit-${index}`,
      message: `commit-${index}`,
      author_name: 'Author',
      date: new Date().toISOString(),
      parents: index < COMMIT_COUNT - 1 ? [`commit-${index + 1}`] : [],
      refs: branch ? (index === 0 ? `HEAD -> ${branch}` : branch) : ''
    }
  })
}

describe('history selectors performance', () => {
  it('filters 20k commits across 40 visible branches within budget', () => {
    const commits = buildHistory()
    const selected = new Set(
      Array.from({ length: BRANCH_COUNT }, (_unused, index) =>
        refFilterKey('local', `branch-${index}`)
      )
    )
    const remoteNames = new Set(['origin'])

    const started = performance.now()
    const filtered = computeBranchFilterSet(commits, selected, [], remoteNames)
    const onBranch = computeOnBranchSet(commits, remoteNames, 'branch-0')
    const elapsed = performance.now() - started

    expect(filtered?.size).toBe(COMMIT_COUNT)
    expect(onBranch?.size).toBe(COMMIT_COUNT)
    expect(elapsed).toBeLessThan(200)
  })
})

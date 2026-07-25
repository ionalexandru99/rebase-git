import { describe, expect, it } from 'vitest'
import type { GitLogEntry } from '@/types'
import {
  computeBranchFilterSet,
  computeMergeSideRangeIndex,
  computeOnBranchSet,
  computeVisibleSet,
  refFilterKey
} from '../selectors'

const COMMIT_COUNT = 20_000
const BRANCH_COUNT = 40

function buildHistory(commitCount = COMMIT_COUNT): GitLogEntry[] {
  return Array.from({ length: commitCount }, (_unused, index) => {
    const branch = index < BRANCH_COUNT ? `branch-${index}` : null
    return {
      hash: `commit-${index}`,
      message: `commit-${index}`,
      author_name: 'Author',
      date: new Date().toISOString(),
      parents: index < commitCount - 1 ? [`commit-${index + 1}`] : [],
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

  it('walks a hidden side branch once per glyph snapshot', () => {
    const sideCommitCount = 10_000
    let parentReads = 0
    const merge: GitLogEntry = {
      hash: 'merge',
      message: 'merge',
      author_name: 'Author',
      date: '2026-01-01',
      parents: ['main', 'side-0'],
      refs: 'main'
    }
    const main: GitLogEntry = { ...merge, hash: 'main', parents: [], refs: '' }
    const side = Array.from({ length: sideCommitCount }, (_unused, index) => {
      const commit = { ...merge, hash: `side-${index}`, refs: '' }
      Object.defineProperty(commit, 'parents', {
        get: () => {
          parentReads += 1
          return [index === sideCommitCount - 1 ? 'main' : `side-${index + 1}`]
        }
      })
      return commit
    })
    const allCommits = [merge, ...side, main]
    const displayedCommits = [merge, main]
    const sideRanges = computeMergeSideRangeIndex(
      allCommits,
      displayedCommits,
      new Set(['merge', 'main']),
      new Set()
    )

    expect(sideRanges.get('merge')?.glyph).toBe('collapsed')
    expect(sideRanges.get('merge')?.commits.size).toBe(sideCommitCount)
    expect(parentReads).toBe(sideCommitCount)
    expect(sideRanges.get('merge')?.glyph).toBe('collapsed')
    expect(parentReads).toBe(sideCommitCount)
  })

  it('derives branch visibility for 50k loaded commits within budget', () => {
    const commits = buildHistory(50_000)
    const selected = new Set([refFilterKey('local', 'branch-0')])
    const started = performance.now()
    const filtered = computeBranchFilterSet(commits, selected, [], new Set(['origin']))
    const elapsed = performance.now() - started

    expect(filtered?.size).toBe(50_000)
    expect(elapsed).toBeLessThan(500)
  })

  it('searches four commit fields across 50k loaded commits within budget', () => {
    const commits = buildHistory(50_000)
    const started = performance.now()
    const matches = computeVisibleSet('commit-49999', commits)
    const elapsed = performance.now() - started

    expect(matches?.has('commit-49999')).toBe(true)
    expect(elapsed).toBeLessThan(1_000)
  })
})

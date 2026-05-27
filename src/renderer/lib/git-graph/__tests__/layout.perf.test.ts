import { describe, expect, it } from 'vitest'
import { layoutCommits } from '@/lib/git-graph/layout'
import type { GitLogEntry } from '@/types'

function entry(index: number): GitLogEntry {
  const hash = `commit-${index}`
  return {
    hash,
    message: hash,
    author_name: 'Author',
    date: new Date().toISOString(),
    parents: index < 9_999 ? [`commit-${index + 1}`] : [],
    refs: ''
  }
}

describe('layoutCommits performance', () => {
  it('lays out 10k commits within budget', () => {
    const commits = Array.from({ length: 10_000 }, (_unused, index) => entry(index))
    const started = performance.now()
    const result = layoutCommits(commits)
    const elapsed = performance.now() - started

    expect(result.rows).toHaveLength(10_000)
    expect(elapsed).toBeLessThan(200)
  })
})

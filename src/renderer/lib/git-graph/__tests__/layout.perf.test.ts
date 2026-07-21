import { describe, expect, it } from 'vitest'
import { layoutCommits } from '@/lib/git-graph/layout'
import type { GitLogEntry } from '@/types'

const FIXED_DATE = '2024-01-01T00:00:00.000Z'

function entry(hash: string, parents: string[]): GitLogEntry {
  return {
    hash,
    message: hash,
    author_name: 'Author',
    date: FIXED_DATE,
    parents,
    refs: ''
  }
}

function buildLinearCommits(total: number): GitLogEntry[] {
  return Array.from({ length: total }, (_unused, index) =>
    entry(`commit-${index}`, index < total - 1 ? [`commit-${index + 1}`] : [])
  )
}

// Newest-first log of `branchCount` interleaved chains: commit i belongs to branch i % branchCount
// and its first parent is the next commit on that branch (i + branchCount), so all branchCount lanes
// stay alive across the whole scan. Every 50th commit also merges in a neighbouring branch. This
// exercises the O(commits x lanes) lane scans that a single linear chain (1 lane) never touches.
function buildFanOutCommits(total: number, branchCount: number): GitLogEntry[] {
  const commits: GitLogEntry[] = []
  for (let index = 0; index < total; index++) {
    const mainParent = index + branchCount
    const parents: string[] = []
    if (mainParent < total) {
      parents.push(`commit-${mainParent}`)
    }
    if (index % 50 === 0 && mainParent + 1 < total) {
      parents.push(`commit-${mainParent + 1}`)
    }
    commits.push(entry(`commit-${index}`, parents))
  }
  return commits
}

describe('layoutCommits performance', () => {
  it('lays out 10k linear commits within budget', () => {
    const commits = buildLinearCommits(10_000)
    const started = performance.now()
    const result = layoutCommits(commits)
    const elapsed = performance.now() - started

    expect(result.rowCount).toBe(10_000)
    expect(result.maxLanes).toBe(1)
    expect(elapsed).toBeLessThan(200)
  })

  it('lays out 10k commits across 300 interleaved branches within budget', () => {
    const commits = buildFanOutCommits(10_000, 300)
    const started = performance.now()
    const result = layoutCommits(commits)
    const elapsed = performance.now() - started

    expect(result.rowCount).toBe(10_000)
    // Guards the wide O(commits x lanes) path, not just the linear chain.
    expect(result.maxLanes).toBeGreaterThan(100)
    expect(elapsed).toBeLessThan(400)
  })

  it('keeps 50k linear history within deterministic storage budgets', () => {
    const commits = buildLinearCommits(50_000)
    const result = layoutCommits(commits)

    const retainedLaneSlots = result.boundaryChunks.reduce(
      (total, chunk) =>
        total + chunk.boundaries.reduce((chunkTotal, boundary) => chunkTotal + boundary.length, 0),
      0
    )

    expect(result.rowCount).toBe(50_000)
    expect(result.boundaryCount).toBe(50_001)
    expect(retainedLaneSlots).toBeLessThanOrEqual(50_000)
  })

  it('lays out 50k commits across 64 live lanes within scale budgets', () => {
    const commits = buildFanOutCommits(50_000, 64)
    const started = performance.now()
    const result = layoutCommits(commits)
    const elapsed = performance.now() - started
    const retainedLaneSlots = result.boundaryChunks.reduce(
      (total, chunk) =>
        total + chunk.boundaries.reduce((chunkTotal, boundary) => chunkTotal + boundary.length, 0),
      0
    )

    expect(result.rowCount).toBe(50_000)
    expect(result.maxLanes).toBeGreaterThanOrEqual(64)
    expect(result.boundaryCount).toBe(50_001)
    expect(retainedLaneSlots).toBeLessThanOrEqual(3_300_000)
    expect(elapsed).toBeLessThan(500)
  })
})

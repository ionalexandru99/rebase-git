import { describe, expect, it } from 'vitest'
import { matchesCommitPrefix } from '@/lib/git-graph/commit-sequence'

const commits = (...hashes: string[]) => hashes.map((hash) => ({ hash }))

describe('matchesCommitPrefix', () => {
  it('accepts an unchanged prefix followed by appended commits', () => {
    expect(matchesCommitPrefix(commits('a', 'b'), commits('a', 'b', 'c'))).toBe(true)
  })

  it('rejects a sequence with a changed commit inside the prefix', () => {
    expect(matchesCommitPrefix(commits('a', 'b', 'c'), commits('a', 'x', 'c', 'd'))).toBe(false)
  })

  it('can compare only the laid-out part of a longer expected sequence', () => {
    expect(matchesCommitPrefix(commits('a', 'b', 'c'), commits('a', 'b', 'd'), 2)).toBe(true)
  })
})

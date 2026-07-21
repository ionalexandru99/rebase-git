import { describe, expect, it } from 'vitest'
import { buildHeadCommitRange } from '../head-commit-range'

describe('buildHeadCommitRange', () => {
  it('uses the SHA-1 empty tree for a root commit in a SHA-1 repository', () => {
    expect(buildHeadCommitRange(0, 'a'.repeat(40))).toBe(
      '4b825dc642cb6eb9a060e54bf8d69288fbee4904..HEAD'
    )
  })

  it('uses the SHA-256 empty tree for a root commit in a SHA-256 repository', () => {
    const headSha = 'a'.repeat(64)

    expect(buildHeadCommitRange(0, headSha)).toBe(
      '6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321..HEAD'
    )
  })

  it('diffs a non-root commit against its first parent regardless of object format', () => {
    expect(buildHeadCommitRange(1, 'a'.repeat(64))).toBe('HEAD~1..HEAD')
  })
})

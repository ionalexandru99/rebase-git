import { describe, expect, it } from 'vitest'
import {
  summarizeWorkingCopy,
  workingCopySummaryText
} from '@/features/history/working-copy-summary'
import type { GitStatus } from '@/types'

function status(overrides: Partial<GitStatus> = {}): GitStatus {
  return {
    current: 'main',
    modified: [],
    staged: [],
    not_added: [],
    conflicted: [],
    deleted: [],
    created: [],
    renamed: [],
    files: [],
    ...overrides
  }
}

describe('summarizeWorkingCopy', () => {
  it('counts staged and unstaged sides off the porcelain codes', () => {
    const counts = summarizeWorkingCopy(
      status({
        files: [
          { path: 'a.ts', index: 'M', working_dir: ' ' },
          { path: 'b.ts', index: ' ', working_dir: 'M' },
          { path: 'c.ts', index: 'M', working_dir: 'M' },
          { path: 'd.ts', index: '?', working_dir: '?' }
        ]
      })
    )

    expect(counts).toEqual({ staged: 2, unstaged: 3, conflicts: 0 })
  })

  it('keeps conflicts out of both sides and counts them on their own', () => {
    const counts = summarizeWorkingCopy(
      status({
        conflicted: ['both.ts'],
        files: [
          { path: 'both.ts', index: 'U', working_dir: 'U' },
          { path: 'a.ts', index: 'M', working_dir: ' ' }
        ]
      })
    )

    expect(counts).toEqual({ staged: 1, unstaged: 0, conflicts: 1 })
  })

  it('falls back to the status buckets when git gave us no codes', () => {
    const counts = summarizeWorkingCopy(
      status({ staged: ['a.ts'], modified: ['a.ts', 'b.ts'], not_added: ['c.ts'] })
    )

    expect(counts).toEqual({ staged: 1, unstaged: 2, conflicts: 0 })
  })

  it('reads a missing status as an empty working copy', () => {
    expect(summarizeWorkingCopy(null)).toEqual({ staged: 0, unstaged: 0, conflicts: 0 })
  })
})

describe('workingCopySummaryText', () => {
  it('says so when nothing is going on', () => {
    expect(workingCopySummaryText({ staged: 0, unstaged: 0, conflicts: 0 })).toBe('No changes')
  })

  it('spells both sides out', () => {
    expect(workingCopySummaryText({ staged: 2, unstaged: 3, conflicts: 0 })).toBe(
      '2 staged · 3 unstaged'
    )
  })

  it('adds the conflicts when the tree is mid-operation', () => {
    expect(workingCopySummaryText({ staged: 0, unstaged: 1, conflicts: 1 })).toBe(
      '0 staged · 1 unstaged · 1 conflict'
    )
    expect(workingCopySummaryText({ staged: 0, unstaged: 0, conflicts: 2 })).toBe(
      '0 staged · 0 unstaged · 2 conflicts'
    )
  })
})

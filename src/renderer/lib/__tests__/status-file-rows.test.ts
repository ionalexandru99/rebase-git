import { describe, expect, it } from 'vitest'
import { buildStatusFileRows } from '@/lib/status-file-rows'
import type { GitStatus } from '@/types'

const emptyStatus = (): GitStatus => ({
  current: 'main',
  modified: [],
  staged: [],
  not_added: [],
  conflicted: [],
  deleted: [],
  created: [],
  renamed: []
})

describe('buildStatusFileRows', () => {
  it('includes section headers and file rows in order', () => {
    const rows = buildStatusFileRows({
      ...emptyStatus(),
      staged: ['a.ts'],
      modified: ['b.ts']
    })
    expect(rows.filter((row) => row.kind === 'section').map((row) => row.label)).toEqual([
      'Staged',
      'Changes',
      'Untracked'
    ])
    expect(rows.filter((row) => row.kind === 'file').map((row) => row.file)).toEqual([
      'a.ts',
      'b.ts'
    ])
  })
})

import type { GitLogEntry } from '@/types'

type HistoryEntryOverrides = Partial<GitLogEntry> & Pick<GitLogEntry, 'hash'>

export function makeHistoryEntry(overrides: HistoryEntryOverrides): GitLogEntry {
  return {
    message: 'commit message',
    author_name: 'Test Author',
    date: '2026-01-01T00:00:00.000Z',
    parents: [],
    refs: '',
    ...overrides
  }
}

export function createHistoryEntryBuilder(defaults: Partial<GitLogEntry>) {
  return (overrides: HistoryEntryOverrides): GitLogEntry =>
    makeHistoryEntry({ ...defaults, ...overrides })
}

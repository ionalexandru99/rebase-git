import { Either, Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { NonNaNNumber } from '../codec'
import { CommitSummarySchema, GitLogSchema } from '../schemas/git'
import {
  ListPaneWidthQuerySchema,
  ListPaneWidthSchema,
  PersistedTabsSchema,
  RendererErrorReportSchema,
  SidebarPrefsSchema,
  StashEntrySchema
} from '../schemas/ipc'

const rejects = <A, I>(schema: Schema.Schema<A, I>, value: unknown): boolean =>
  Either.isLeft(Schema.decodeUnknownEither(schema)(value))

const accepts = <A, I>(schema: Schema.Schema<A, I>, value: unknown): boolean =>
  Either.isRight(Schema.decodeUnknownEither(schema)(value))

describe('NonNaNNumber', () => {
  it('rejects NaN where Schema.Number would have accepted it', () => {
    expect(accepts(Schema.Number, NaN)).toBe(true)
    expect(rejects(NonNaNNumber, NaN)).toBe(true)
  })

  it('accepts finite numbers', () => {
    expect(accepts(NonNaNNumber, 0)).toBe(true)
    expect(accepts(NonNaNNumber, -3)).toBe(true)
    expect(accepts(NonNaNNumber, 240)).toBe(true)
  })
})

describe('persisted numeric fields reject NaN', () => {
  it('SidebarPrefsSchema.width', () => {
    expect(accepts(SidebarPrefsSchema, { open: true, width: 240 })).toBe(true)
    expect(rejects(SidebarPrefsSchema, { open: true, width: NaN })).toBe(true)
  })

  it('PersistedTabsSchema.activeIndex', () => {
    expect(accepts(PersistedTabsSchema, { tabs: [null], activeIndex: 0 })).toBe(true)
    expect(rejects(PersistedTabsSchema, { tabs: [null], activeIndex: NaN })).toBe(true)
  })

  it('ListPaneWidthSchema.width', () => {
    expect(accepts(ListPaneWidthSchema, { repoPath: '/repo/a', width: 400 })).toBe(true)
    expect(rejects(ListPaneWidthSchema, { repoPath: '/repo/a', width: NaN })).toBe(true)
  })

  it('ListPaneWidth schemas require a non-empty repo path', () => {
    expect(accepts(ListPaneWidthQuerySchema, { repoPath: '/repo/a' })).toBe(true)
    expect(rejects(ListPaneWidthQuerySchema, { repoPath: '' })).toBe(true)
    expect(rejects(ListPaneWidthSchema, { repoPath: '   ', width: 400 })).toBe(true)
  })

  it('StashEntrySchema.index', () => {
    const base = { ref: 'stash@{0}', oid: 'abc123', message: 'wip', branch: 'main' }
    expect(accepts(StashEntrySchema, { ...base, index: 0 })).toBe(true)
    expect(rejects(StashEntrySchema, { ...base, index: NaN })).toBe(true)
  })
})

describe('wire numeric fields reject NaN', () => {
  it('GitLogSchema.loadedCount', () => {
    expect(accepts(GitLogSchema, { all: [], loadedCount: 0 })).toBe(true)
    expect(rejects(GitLogSchema, { all: [], loadedCount: NaN })).toBe(true)
    expect(rejects(GitLogSchema, { all: [], total: 0 })).toBe(true)
  })

  it('CommitSummarySchema summary counts', () => {
    const summary = {
      commit: 'abc',
      branch: 'main',
      summary: { changes: 1, insertions: NaN, deletions: 0 }
    }
    expect(rejects(CommitSummarySchema, summary)).toBe(true)
  })
})

describe('RendererErrorReportSchema', () => {
  it('accepts a report carrying only a message', () => {
    expect(accepts(RendererErrorReportSchema, { message: 'render failed' })).toBe(true)
  })

  it('accepts a full report with both stacks', () => {
    expect(
      accepts(RendererErrorReportSchema, {
        message: 'cannot read length of null',
        stack: 'TypeError: cannot read length of null\n    at CommitList',
        componentStack: '\n    in CommitList\n    in TabView'
      })
    ).toBe(true)
  })

  it('rejects a report the crash log could not identify', () => {
    expect(rejects(RendererErrorReportSchema, {})).toBe(true)
    expect(rejects(RendererErrorReportSchema, { message: '' })).toBe(true)
    expect(rejects(RendererErrorReportSchema, { message: '   ' })).toBe(true)
  })

  it('rejects non-string stacks', () => {
    expect(rejects(RendererErrorReportSchema, { message: 'boom', stack: 42 })).toBe(true)
    expect(rejects(RendererErrorReportSchema, { message: 'boom', componentStack: {} })).toBe(true)
  })
})

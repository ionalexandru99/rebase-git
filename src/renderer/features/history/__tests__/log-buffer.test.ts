import { describe, expect, it } from 'vitest'
import type { GitLogEntry } from '@/types'
import { createCommitLogBuffer } from '../log-buffer'

const commit = (hash: string): GitLogEntry => ({
  hash,
  message: hash,
  author_name: 'Test',
  date: '2026-01-01T00:00:00Z',
  parents: [],
  refs: ''
})

describe('commit log buffer', () => {
  it('publishes each revision once', () => {
    const buffer = createCommitLogBuffer()
    buffer.beginStream()

    expect(buffer.getPublishableSnapshot()).toEqual([])
    buffer.markCurrentAsFlushed()
    expect(buffer.getPublishableSnapshot()).toBeNull()

    buffer.append([commit('a')])
    expect(buffer.getPublishableSnapshot()?.map((entry) => entry.hash)).toEqual(['a'])
    buffer.markCurrentAsFlushed()
    expect(buffer.getPublishableSnapshot()).toBeNull()
  })

  it('deduplicates commits within and across chunks', () => {
    const buffer = createCommitLogBuffer()

    expect(buffer.append([commit('a'), commit('a'), commit('b')])).toBe(true)
    expect(buffer.entries.map((entry) => entry.hash)).toEqual(['a', 'b'])
    buffer.markCurrentAsFlushed()

    expect(buffer.append([commit('a'), commit('b')])).toBe(false)
    expect(buffer.getPublishableSnapshot()).toBeNull()
  })

  it('does not mutate a previously published snapshot', () => {
    const buffer = createCommitLogBuffer()
    buffer.append([commit('a')])
    const published = buffer.getPublishableSnapshot()
    buffer.markCurrentAsFlushed()

    buffer.append([commit('b')])

    expect(published?.map((entry) => entry.hash)).toEqual(['a'])
    expect(buffer.entries.map((entry) => entry.hash)).toEqual(['a', 'b'])
    expect(buffer.entries).not.toBe(published)
  })

  it('restores a cached snapshot as already published', () => {
    const buffer = createCommitLogBuffer()
    const cached = [commit('cached')]

    buffer.restore(cached, true)

    expect(buffer.entries).not.toBe(cached)
    expect(buffer.getPublishableSnapshot()).toBeNull()
    buffer.append([commit('next')])
    expect(buffer.getPublishableSnapshot()?.map((entry) => entry.hash)).toEqual(['cached', 'next'])
  })

  it('keeps an initial cache publication dirty for the stream completion flush', () => {
    const buffer = createCommitLogBuffer()
    buffer.beginStream()

    const initial = buffer.markCurrentAsPublished()

    expect(buffer.getPublishableSnapshot()).toBe(initial)
    buffer.append([commit('next')])
    expect(initial).toEqual([])
  })

  it('clears entries, hashes, and publication state', () => {
    const buffer = createCommitLogBuffer()
    buffer.append([commit('a')])
    buffer.markCurrentAsFlushed()

    buffer.clear()

    expect(buffer.length).toBe(0)
    expect(buffer.append([commit('a')])).toBe(true)
    expect(buffer.getPublishableSnapshot()?.map((entry) => entry.hash)).toEqual(['a'])
  })
})

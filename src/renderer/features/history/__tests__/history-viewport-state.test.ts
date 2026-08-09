import { describe, expect, it } from 'vitest'
import {
  canRestoreHistoryScroll,
  createHistoryScrollMemory,
  nextHistoryAutoLoadKey
} from '../history-viewport-state'

describe('history viewport state', () => {
  it('remembers scroll positions independently by repository', () => {
    const memory = createHistoryScrollMemory()

    memory.remember('/first', 120)
    memory.remember('/second', 240)

    expect(memory.get('/first')).toBe(120)
    expect(memory.get('/second')).toBe(240)
    expect(memory.get('/missing')).toBe(0)
  })

  it('evicts the least recently remembered repository', () => {
    const memory = createHistoryScrollMemory(2)
    memory.remember('/first', 100)
    memory.remember('/second', 200)
    memory.remember('/first', 150)
    memory.remember('/third', 300)

    expect(memory.get('/first')).toBe(150)
    expect(memory.get('/second')).toBe(0)
    expect(memory.get('/third')).toBe(300)
  })

  it('creates a page-specific auto-load key near the end of history', () => {
    const key = nextHistoryAutoLoadKey(
      {
        endIndex: 17,
        commitCount: 20,
        hasMore: true,
        loading: false,
        loadingMore: false,
        canLoadMore: true,
        repoPath: '/repo',
        loadedCount: 20
      },
      null
    )

    expect(key).toBe('["local","/repo"]:20')
  })

  it('does not repeat auto-load for the same repository page', () => {
    const input = {
      endIndex: 17,
      commitCount: 20,
      hasMore: true,
      loading: false,
      loadingMore: false,
      canLoadMore: true,
      repoPath: '/repo',
      loadedCount: 20
    }

    expect(nextHistoryAutoLoadKey(input, '["local","/repo"]:20')).toBeNull()
    expect(nextHistoryAutoLoadKey({ ...input, loadedCount: 40 }, '["local","/repo"]:20')).toBe(
      '["local","/repo"]:40'
    )
  })

  it.each([
    { endIndex: 16, hasMore: true, loading: false, loadingMore: false, canLoadMore: true },
    { endIndex: 17, hasMore: false, loading: false, loadingMore: false, canLoadMore: true },
    { endIndex: 17, hasMore: true, loading: true, loadingMore: false, canLoadMore: true },
    { endIndex: 17, hasMore: true, loading: false, loadingMore: true, canLoadMore: true },
    { endIndex: 17, hasMore: true, loading: false, loadingMore: false, canLoadMore: false }
  ])('waits when auto-load preconditions are not met', (state) => {
    expect(
      nextHistoryAutoLoadKey(
        {
          ...state,
          commitCount: 20,
          repoPath: '/repo',
          loadedCount: 20
        },
        null
      )
    ).toBeNull()
  })

  it('restores scroll only after the content can reach the remembered position', () => {
    expect(canRestoreHistoryScroll(0, 100, 80)).toBe(true)
    expect(canRestoreHistoryScroll(320, 300, 100)).toBe(false)
    expect(canRestoreHistoryScroll(320, 500, 100)).toBe(true)
  })
})

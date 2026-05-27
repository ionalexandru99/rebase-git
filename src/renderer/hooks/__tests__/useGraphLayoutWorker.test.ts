import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildDisplayRows, useGraphLayoutWorker } from '@/hooks/useGraphLayoutWorker'
import { createSignal } from '@/lib/react-compat'
import type { GitLogEntry } from '@/types'

function entry(hash: string, parents: string[] = []): GitLogEntry {
  return {
    hash,
    message: hash,
    author_name: 'Author',
    date: new Date().toISOString(),
    parents,
    refs: ''
  }
}

describe('useGraphLayoutWorker', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lays out commits synchronously', async () => {
    const { result } = renderHook(() =>
      useGraphLayoutWorker({
        commits: () => [entry('a', ['b']), entry('b')],
        loading: () => false,
        enabled: () => true,
        debounceMs: 0
      })
    )

    await waitFor(() => {
      expect(result.current.layout()?.rows).toHaveLength(2)
    })
    expect(result.current.laidOutThroughIndex()).toBe(2)
    expect(result.current.layout()?.maxLanes).toBeGreaterThan(0)
  })

  it('lays out the first batch immediately while history is still loading', async () => {
    const { result } = renderHook(() =>
      useGraphLayoutWorker({
        commits: () => [entry('a')],
        loading: () => true,
        enabled: () => true,
        debounceMs: 250
      })
    )

    await waitFor(() => {
      expect(result.current.layout()?.rows).toHaveLength(1)
    })
  })

  it('recomputes layout when the filtered commit list shrinks', async () => {
    const { result } = renderHook(() => {
      const [commits, setCommits] = createSignal([entry('a', ['b']), entry('b', ['c']), entry('c')])
      return {
        graphLayout: useGraphLayoutWorker({
          commits,
          loading: () => false,
          enabled: () => true,
          debounceMs: 0
        }),
        setCommits
      }
    })

    await waitFor(() => {
      expect(result.current.graphLayout.layout()?.rows).toHaveLength(3)
    })

    act(() => {
      result.current.setCommits([entry('a', ['b']), entry('b')])
    })

    await waitFor(() => {
      expect(result.current.graphLayout.layout()?.rows).toHaveLength(2)
    })
    expect(result.current.graphLayout.layout()?.commits.map((commit) => commit.hash)).toEqual([
      'a',
      'b'
    ])
  })

  it('buildDisplayRows fills beyond laid-out indices with empty graph rows', () => {
    const commits = [entry('a'), entry('b'), entry('c')]
    const layout = {
      rows: [
        {
          commit: commits[0],
          commitLane: 0,
          incoming: [],
          outgoing: ['b']
        }
      ],
      maxLanes: 1,
      lanesAfter: ['b'],
      commits: [commits[0]],
      laidOutThroughIndex: 1
    }

    const rows = buildDisplayRows(commits, layout, 1)
    expect(rows).toHaveLength(3)
    expect(rows[0].commit.hash).toBe('a')
    expect(rows[1].incoming).toEqual([])
    expect(rows[2].incoming).toEqual([])
  })
})

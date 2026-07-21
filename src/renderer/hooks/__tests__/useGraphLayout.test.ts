import { act, renderHook, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useGraphLayout } from '@/hooks/useGraphLayout'
import type { LayoutResult } from '@/lib/git-graph/layout'
import { getLayoutBoundary, getLayoutRow, layoutCommits } from '@/lib/git-graph/layout'
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

describe('useGraphLayout', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lays out commits synchronously', async () => {
    const { result } = renderHook(() =>
      useGraphLayout({
        commits: [entry('a', ['b']), entry('b')],
        loading: false,
        enabled: true,
        debounceMs: 0
      })
    )

    await waitFor(() => {
      expect(result.current.layout?.rowCount).toBe(2)
    })
    expect(result.current.laidOutThroughIndex).toBe(2)
    expect(result.current.layout?.maxLanes).toBeGreaterThan(0)
  })

  it('lays out the first batch immediately while history is still loading', async () => {
    const { result } = renderHook(() =>
      useGraphLayout({
        commits: [entry('a')],
        loading: true,
        enabled: true,
        debounceMs: 250
      })
    )

    await waitFor(() => {
      expect(result.current.layout?.rowCount).toBe(1)
    })
  })

  it('recomputes layout when the filtered commit list shrinks', async () => {
    const { result } = renderHook(() => {
      const [commits, setCommits] = useState([entry('a', ['b']), entry('b', ['c']), entry('c')])
      return {
        graphLayout: useGraphLayout({
          commits,
          loading: false,
          enabled: true,
          debounceMs: 0
        }),
        setCommits
      }
    })

    await waitFor(() => {
      expect(result.current.graphLayout.layout?.rowCount).toBe(3)
    })

    act(() => {
      result.current.setCommits([entry('a', ['b']), entry('b')])
    })

    await waitFor(() => {
      expect(result.current.graphLayout.layout?.rowCount).toBe(2)
    })
    expect(result.current.graphLayout.layout?.commits.map((commit) => commit.hash)).toEqual([
      'a',
      'b'
    ])
  })

  it('relayouts immediately on a non-append change even while history is loading', () => {
    const { result } = renderHook(() => {
      const [commits, setCommits] = useState([entry('a', ['b']), entry('b', ['c']), entry('c')])
      return {
        graphLayout: useGraphLayout({ commits, loading: true, enabled: true, debounceMs: 250 }),
        setCommits
      }
    })

    expect(result.current.graphLayout.layout?.rowCount).toBe(3)

    act(() => {
      result.current.setCommits([entry('a', ['b']), entry('b')])
    })

    // No debounce timer is advanced: a collapse must take effect on the same commit, not 250ms later.
    expect(result.current.graphLayout.layout?.rowCount).toBe(2)
  })

  it('relayouts an unchanged sequence when a carried parent becomes hidden', () => {
    const initialCommits = [entry('merge', ['main-parent', 'side-parent']), entry('main-parent')]
    const { result } = renderHook(() => {
      const [commits, setCommits] = useState(initialCommits)
      const [hiddenParents, setHiddenParents] = useState<ReadonlySet<string>>(new Set())
      return {
        graphLayout: useGraphLayout({
          commits,
          loading: false,
          enabled: true,
          debounceMs: 0,
          isHiddenParent: (hash) => hiddenParents.has(hash)
        }),
        hideSideParent: () => {
          setHiddenParents(new Set(['side-parent']))
          setCommits([...initialCommits])
        }
      }
    })

    expect(getLayoutBoundary(result.current.graphLayout.layout as LayoutResult, 1)).toContain(
      'side-parent'
    )

    act(() => {
      result.current.hideSideParent()
    })

    expect(getLayoutBoundary(result.current.graphLayout.layout as LayoutResult, 1)).not.toContain(
      'side-parent'
    )
    expect(result.current.graphLayout.layout?.maxLanes).toBe(1)
  })

  it('clears stale layout when graph rendering is disabled', () => {
    const commits = [entry('a')]
    const { result, rerender } = renderHook(
      ({ enabled }) =>
        useGraphLayout({ commits: enabled ? commits : [], loading: false, enabled, debounceMs: 0 }),
      { initialProps: { enabled: true } }
    )

    expect(result.current.layout?.rowCount).toBe(1)
    rerender({ enabled: false })

    expect(result.current.layout).toBeNull()
    expect(result.current.laidOutThroughIndex).toBe(0)
  })

  it('rejects a stale worker relayout by generation', () => {
    const workers: FakeWorker[] = []
    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null
      postMessage = vi.fn()
      terminate = vi.fn()

      constructor() {
        workers.push(this)
      }

      emit(data: unknown) {
        this.onmessage?.({ data } as MessageEvent)
      }
    }
    vi.stubGlobal('Worker', FakeWorker)
    const initial = [entry('a')]
    const replacement = [entry('b')]
    const { result, rerender } = renderHook(
      ({ commits }) => useGraphLayout({ commits, loading: false, enabled: true, debounceMs: 0 }),
      { initialProps: { commits: initial } }
    )

    rerender({ commits: replacement })
    const worker = workers[0]
    const firstGeneration = worker.postMessage.mock.calls[0][0].generation
    const secondGeneration = worker.postMessage.mock.calls[1][0].generation
    expect(result.current.laidOutThroughIndex).toBe(0)
    act(() => {
      worker.emit({ generation: firstGeneration, layout: layoutCommits(initial) })
    })
    expect(result.current.layout).toBeNull()

    act(() => {
      worker.emit({ generation: secondGeneration, layout: layoutCommits(replacement) })
    })
    expect(getLayoutRow(result.current.layout as LayoutResult, 0)?.commit.hash).toBe('b')
  })

  it('rejects a pending worker relayout after reusing the rendered sequence', () => {
    const workers: FakeWorker[] = []
    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null
      postMessage = vi.fn()
      terminate = vi.fn()

      constructor() {
        workers.push(this)
      }

      emit(data: unknown) {
        this.onmessage?.({ data } as MessageEvent)
      }
    }
    vi.stubGlobal('Worker', FakeWorker)
    const initial = [entry('a')]
    const replacement = [entry('b')]
    const { result, rerender } = renderHook(
      ({ commits }) => useGraphLayout({ commits, loading: false, enabled: true, debounceMs: 0 }),
      { initialProps: { commits: initial } }
    )
    const worker = workers[0]
    const initialGeneration = worker.postMessage.mock.calls[0][0].generation
    act(() => {
      worker.emit({ generation: initialGeneration, layout: layoutCommits(initial) })
    })

    rerender({ commits: replacement })
    const replacementGeneration = worker.postMessage.mock.calls[1][0].generation
    rerender({ commits: initial })

    expect(result.current.layoutPending).toBe(false)
    expect(getLayoutRow(result.current.layout as LayoutResult, 0)?.commit.hash).toBe('a')

    act(() => {
      worker.emit({ generation: replacementGeneration, layout: layoutCommits(replacement) })
    })

    expect(result.current.layoutPending).toBe(false)
    expect(getLayoutRow(result.current.layout as LayoutResult, 0)?.commit.hash).toBe('a')
  })

  it('falls back from a failed worker and recreates it for the next layout', () => {
    const workers: FakeWorker[] = []
    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: ((event: ErrorEvent) => void) | null = null
      postMessage = vi.fn()
      terminate = vi.fn()

      constructor() {
        workers.push(this)
      }

      fail() {
        this.onerror?.({ preventDefault: vi.fn() } as unknown as ErrorEvent)
      }
    }
    vi.stubGlobal('Worker', FakeWorker)
    const initial = [entry('a')]
    const replacement = [entry('b')]
    const { result, rerender } = renderHook(
      ({ commits }) => useGraphLayout({ commits, loading: false, enabled: true, debounceMs: 0 }),
      { initialProps: { commits: initial } }
    )

    expect(result.current.layoutPending).toBe(true)
    act(() => {
      workers[0].fail()
    })

    expect(result.current.layoutPending).toBe(false)
    expect(getLayoutRow(result.current.layout as LayoutResult, 0)?.commit.hash).toBe('a')
    expect(workers[0].terminate).toHaveBeenCalledOnce()
    expect(workers).toHaveLength(2)

    rerender({ commits: replacement })

    expect(workers[1].postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ commits: replacement })
    )
  })

  it('lays out synchronously when worker construction fails', () => {
    class BrokenWorker {
      constructor() {
        throw new Error('worker unavailable')
      }
    }
    vi.stubGlobal('Worker', BrokenWorker)

    const { result } = renderHook(() =>
      useGraphLayout({ commits: [entry('a')], loading: false, enabled: true, debounceMs: 0 })
    )

    expect(result.current.layoutPending).toBe(false)
    expect(getLayoutRow(result.current.layout as LayoutResult, 0)?.commit.hash).toBe('a')
  })
})

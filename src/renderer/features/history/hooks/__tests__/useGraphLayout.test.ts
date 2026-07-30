import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CHECKPOINT_ROWS, layoutGraph } from '@/features/history/graph/layout'
import {
  detachLayout,
  type GraphLayoutRequest
} from '@/features/history/graph/layout-worker-protocol'
import { buildGraphTopology } from '@/features/history/graph/topology'
import { useGraphLayout } from '@/features/history/hooks/useGraphLayout'
import type { GitLogEntry } from '@/types'

function entry(hash: string, parents: string[] = []): GitLogEntry {
  return {
    hash,
    message: hash,
    author_name: 'Author',
    date: '2024-01-01T00:00:00.000Z',
    parents,
    refs: ''
  }
}

function chain(length: number): GitLogEntry[] {
  return Array.from({ length }, (_unused, index) =>
    entry(`c${index}`, index < length - 1 ? [`c${index + 1}`] : [])
  )
}

function layoutFor(commits: GitLogEntry[]) {
  return detachLayout(layoutGraph(buildGraphTopology(commits)))
}

class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  postMessage = vi.fn()
  terminate = vi.fn()

  constructor() {
    FakeWorker.instances.push(this)
  }

  get requests(): GraphLayoutRequest[] {
    return this.postMessage.mock.calls.map((call) => call[0] as GraphLayoutRequest)
  }

  reply(data: unknown) {
    act(() => {
      this.onmessage?.({ data } as MessageEvent)
    })
  }

  fail() {
    act(() => {
      this.onerror?.({ preventDefault: vi.fn() } as unknown as ErrorEvent)
    })
  }
}

function useWorkers(): typeof FakeWorker.instances {
  FakeWorker.instances = []
  vi.stubGlobal('Worker', FakeWorker)
  return FakeWorker.instances
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useGraphLayout without a worker', () => {
  it('lays out commits on the spot', () => {
    const { result } = renderHook(() =>
      useGraphLayout({ commits: [entry('a', ['b']), entry('b')], enabled: true })
    )

    expect(result.current.layout.commitCount).toBe(2)
    expect(result.current.validRows).toBe(2)
    expect(result.current.pending).toBe(false)
  })

  it('recomputes when the filtered commit list shrinks', () => {
    const { result } = renderHook(() => {
      const [commits, setCommits] = useState([entry('a', ['b']), entry('b', ['c']), entry('c')])
      return { graph: useGraphLayout({ commits, enabled: true }), setCommits }
    })

    expect(result.current.graph.layout.commitCount).toBe(3)

    act(() => {
      result.current.setCommits([entry('a', ['b']), entry('b')])
    })

    expect(result.current.graph.layout.commitCount).toBe(2)
    expect(result.current.graph.validRows).toBe(2)
  })

  it('relayouts an unchanged sequence when a carried parent becomes hidden', () => {
    const commits = [entry('merge', ['main-parent', 'side-parent']), entry('main-parent')]
    const { result } = renderHook(() => {
      const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
      return {
        graph: useGraphLayout({
          commits,
          enabled: true,
          isHiddenParent: (hash) => hidden.has(hash)
        }),
        hideSideParent: () => setHidden(new Set(['side-parent']))
      }
    })

    expect(result.current.graph.layout.maxLanes).toBe(2)

    act(() => {
      result.current.hideSideParent()
    })

    expect(result.current.graph.layout.maxLanes).toBe(1)
  })

  it('clears the layout when graph rendering is disabled', () => {
    const commits = [entry('a')]
    const { result, rerender } = renderHook(({ enabled }) => useGraphLayout({ commits, enabled }), {
      initialProps: { enabled: true }
    })

    expect(result.current.layout.commitCount).toBe(1)

    rerender({ enabled: false })

    expect(result.current.layout.commitCount).toBe(0)
    expect(result.current.validRows).toBe(0)
  })

  it('keeps the same layout object when nothing about the graph changed', () => {
    const first = [entry('a', ['b']), entry('b')]
    const { result, rerender } = renderHook(
      ({ commits }) => useGraphLayout({ commits, enabled: true }),
      {
        initialProps: { commits: first }
      }
    )
    const before = result.current.layout

    rerender({ commits: [...first] })

    expect(result.current.layout).toBe(before)
  })
})

describe('useGraphLayout with a worker', () => {
  it('sends the whole log first, then only the tail past the last checkpoint', () => {
    const workers = useWorkers()
    const page1 = chain(300)
    const { rerender } = renderHook(({ commits }) => useGraphLayout({ commits, enabled: true }), {
      initialProps: { commits: page1 }
    })

    const worker = workers[0]
    expect(worker.requests[0].topology.firstRow).toBe(0)
    worker.reply({
      status: 'ready',
      generation: worker.requests[0].generation,
      layout: layoutFor(page1)
    })

    rerender({ commits: [...page1.slice(0, 299), entry('c299', ['z']), entry('z')] })

    expect(worker.requests[1].topology.firstRow).toBe(CHECKPOINT_ROWS * 2)
    expect(worker.requests[1].topology.commitCount).toBe(301)
  })

  it('keeps showing the rows that survived while a relayout is in flight', () => {
    const workers = useWorkers()
    const page1 = [entry('a', ['b']), entry('b')]
    const { result, rerender } = renderHook(
      ({ commits }) => useGraphLayout({ commits, enabled: true }),
      { initialProps: { commits: page1 } }
    )
    const worker = workers[0]
    worker.reply({
      status: 'ready',
      generation: worker.requests[0].generation,
      layout: layoutFor(page1)
    })

    rerender({ commits: [...page1, entry('z')] })

    expect(result.current.pending).toBe(true)
    expect(result.current.validRows).toBe(2)
    expect(result.current.layout.commitCount).toBe(2)
  })

  it('drops rows that a reshaped log invalidated instead of drawing stale lanes', () => {
    const workers = useWorkers()
    const { result, rerender } = renderHook(
      ({ commits }) => useGraphLayout({ commits, enabled: true }),
      { initialProps: { commits: [entry('a', ['b']), entry('b')] } }
    )
    const worker = workers[0]
    worker.reply({
      status: 'ready',
      generation: worker.requests[0].generation,
      layout: layoutFor([entry('a', ['b']), entry('b')])
    })

    rerender({ commits: [entry('x'), entry('y')] })

    expect(result.current.validRows).toBe(0)
  })

  it('ignores a reply that a newer request has superseded', () => {
    const workers = useWorkers()
    const { result, rerender } = renderHook(
      ({ commits }) => useGraphLayout({ commits, enabled: true }),
      { initialProps: { commits: [entry('a')] } }
    )
    const worker = workers[0]
    const stale = worker.requests[0].generation

    rerender({ commits: [entry('b', ['c']), entry('c')] })
    worker.reply({ status: 'ready', generation: stale, layout: layoutFor([entry('a')]) })

    expect(result.current.pending).toBe(true)
    expect(result.current.layout.commitCount).toBe(0)

    worker.reply({
      status: 'ready',
      generation: worker.requests[1].generation,
      layout: layoutFor([entry('b', ['c']), entry('c')])
    })

    expect(result.current.layout.commitCount).toBe(2)
    expect(result.current.pending).toBe(false)
  })

  it('resends the whole log when the worker cannot extend what it holds', () => {
    const workers = useWorkers()
    const page1 = [entry('a', ['b']), entry('b')]
    const { rerender } = renderHook(({ commits }) => useGraphLayout({ commits, enabled: true }), {
      initialProps: { commits: page1 }
    })
    const worker = workers[0]
    worker.reply({
      status: 'ready',
      generation: worker.requests[0].generation,
      layout: layoutFor(page1)
    })
    rerender({ commits: [...page1, entry('z')] })

    worker.reply({ status: 'needs-full-topology', generation: worker.requests[1].generation })

    expect(worker.requests[2].topology.firstRow).toBe(0)
    expect(worker.requests[2].topology.commitCount).toBe(3)
  })

  it('falls back to laying out inline when the worker fails, and replaces it', () => {
    const workers = useWorkers()
    const { result, rerender } = renderHook(
      ({ commits }) => useGraphLayout({ commits, enabled: true }),
      { initialProps: { commits: [entry('a', ['b']), entry('b')] } }
    )

    expect(result.current.pending).toBe(true)
    workers[0].fail()

    expect(result.current.pending).toBe(false)
    expect(result.current.layout.commitCount).toBe(2)
    expect(workers[0].terminate).toHaveBeenCalledOnce()

    rerender({ commits: [entry('a', ['b']), entry('b'), entry('z')] })

    expect(workers).toHaveLength(2)
    expect(workers[1].requests[0].topology.firstRow).toBe(0)
  })

  it('lays out inline when the worker cannot even be constructed', () => {
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new Error('worker unavailable')
        }
      }
    )

    const { result } = renderHook(() => useGraphLayout({ commits: [entry('a')], enabled: true }))

    expect(result.current.pending).toBe(false)
    expect(result.current.layout.commitCount).toBe(1)
  })

  it('does not re-request when a fresh commits array describes the same graph', () => {
    const workers = useWorkers()
    const commits = [entry('a', ['b']), entry('b')]
    const { rerender } = renderHook(({ log }) => useGraphLayout({ commits: log, enabled: true }), {
      initialProps: { log: commits }
    })

    rerender({ log: [...commits] })
    rerender({ log: commits.map((commit) => ({ ...commit })) })

    expect(workers[0].requests).toHaveLength(1)
  })

  it('terminates its worker on unmount', () => {
    const workers = useWorkers()
    const { unmount } = renderHook(() => useGraphLayout({ commits: [entry('a')], enabled: true }))

    unmount()

    expect(workers[0].terminate).toHaveBeenCalledOnce()
  })
})

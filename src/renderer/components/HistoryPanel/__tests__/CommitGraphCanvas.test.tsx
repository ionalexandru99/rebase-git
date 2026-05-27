import { render } from '@solidjs/testing-library'
import { createSignal } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommitGraphCanvas } from '@/components/HistoryPanel/CommitGraphCanvas'
import type { RowLayout } from '@/lib/git-graph/layout'
import type { GitLogEntry } from '@/types'

function entry(hash: string): GitLogEntry {
  return {
    hash,
    message: hash,
    author_name: 'Author',
    date: new Date().toISOString(),
    parents: [],
    refs: ''
  }
}

function row(hash: string, lane = 0): RowLayout {
  return {
    commit: entry(hash),
    commitLane: lane,
    incoming: [hash],
    outgoing: []
  }
}

describe('CommitGraphCanvas', () => {
  let strokeCount = 0
  let fillCount = 0

  beforeEach(() => {
    strokeCount = 0
    fillCount = 0
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      bezierCurveTo: vi.fn(),
      stroke: vi.fn(() => {
        strokeCount++
      }),
      arc: vi.fn(),
      fill: vi.fn(() => {
        fillCount++
      })
    } as unknown as CanvasRenderingContext2D)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('redraws when the visible filter set changes', async () => {
    const [scrollEl, setScrollEl] = createSignal<HTMLDivElement | undefined>()
    const [visibleSet, setVisibleSet] = createSignal<Set<string> | null>(new Set(['a']))
    const scrollContainer = document.createElement('div')
    Object.defineProperty(scrollContainer, 'scrollTop', { value: 0, writable: true })
    setScrollEl(scrollContainer)

    const { unmount } = render(() => (
      <CommitGraphCanvas
        rows={[row('a'), row('b')]}
        scrollContainer={scrollEl}
        viewportHeight={400}
        visibleSet={visibleSet()}
        railWidth={40}
        themeNonce={0}
        scrollTop={0}
        startIndex={0}
        endIndex={2}
        graphLayoutEndIndex={2}
      />
    ))

    await vi.waitFor(() => {
      expect(strokeCount + fillCount).toBeGreaterThan(0)
    })
    const before = strokeCount + fillCount

    setVisibleSet(new Set(['b']))
    await vi.waitFor(() => {
      expect(strokeCount + fillCount).toBeGreaterThan(before)
    })

    unmount()
  })

  it('skips rows beyond graphLayoutEndIndex', async () => {
    const scrollContainer = document.createElement('div')
    Object.defineProperty(scrollContainer, 'scrollTop', { value: 0, writable: true })
    const [scrollEl] = createSignal<HTMLDivElement | undefined>(scrollContainer)

    render(() => (
      <CommitGraphCanvas
        rows={[row('a'), row('b')]}
        scrollContainer={scrollEl}
        viewportHeight={400}
        visibleSet={null}
        railWidth={40}
        themeNonce={0}
        scrollTop={0}
        startIndex={0}
        endIndex={2}
        graphLayoutEndIndex={1}
      />
    ))

    await vi.waitFor(() => {
      expect(fillCount).toBeGreaterThan(0)
    })
    expect(strokeCount).toBeLessThan(4)
  })

  it('redraws when visible row graph geometry changes without changing row count', async () => {
    const scrollContainer = document.createElement('div')
    Object.defineProperty(scrollContainer, 'scrollTop', { value: 0, writable: true })
    const [scrollEl] = createSignal<HTMLDivElement | undefined>(scrollContainer)
    const [rows, setRows] = createSignal<RowLayout[]>([
      { ...row('a'), incoming: [], outgoing: [] },
      { ...row('b'), incoming: [], outgoing: [] }
    ])

    render(() => (
      <CommitGraphCanvas
        rows={rows()}
        scrollContainer={scrollEl}
        viewportHeight={400}
        visibleSet={null}
        railWidth={40}
        themeNonce={0}
        scrollTop={0}
        startIndex={0}
        endIndex={2}
        graphLayoutEndIndex={2}
      />
    ))

    await vi.waitFor(() => {
      expect(fillCount).toBeGreaterThan(0)
    })
    const before = strokeCount + fillCount

    setRows([row('a'), row('b')])

    await vi.waitFor(() => {
      expect(strokeCount + fillCount).toBeGreaterThan(before)
    })
  })
})

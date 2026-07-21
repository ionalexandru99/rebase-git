import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommitGraphCanvas } from '@/components/HistoryPanel/CommitGraphCanvas'
import { LANE_PALETTE } from '@/lib/git-graph/canvas'
import type { LaneBoundary, LayoutResult, RowLayout } from '@/lib/git-graph/layout'
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
    commitLane: lane
  }
}

function wideRow(hash: string): RowLayout {
  return {
    commit: entry(hash),
    commitLane: 0
  }
}

function canvasLayout(rows: RowLayout[], boundaries?: LaneBoundary[]): LayoutResult {
  const laneBoundaries =
    boundaries ?? Array.from({ length: rows.length + 1 }, () => [] as LaneBoundary)
  return {
    rowChunks: [{ startIndex: 0, rows }],
    boundaryChunks: [{ startIndex: 0, boundaries: laneBoundaries }],
    rowCount: rows.length,
    boundaryCount: rows.length + 1,
    maxLanes: 1,
    lanesAfter: laneBoundaries.at(-1) ?? [],
    commits: rows.map((row) => row.commit),
    laidOutThroughIndex: rows.length
  }
}

describe('CommitGraphCanvas', () => {
  let strokeCount = 0
  let fillCount = 0
  let arcRadii: number[] = []

  beforeEach(() => {
    strokeCount = 0
    fillCount = 0
    arcRadii = []
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
      arc: vi.fn((_x: number, _y: number, radius: number) => {
        arcRadii.push(radius)
      }),
      fill: vi.fn(() => {
        fillCount++
      })
    } as unknown as CanvasRenderingContext2D)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    document.documentElement.style.fontSize = ''
  })

  it('redraws when the visible filter set changes', async () => {
    const scrollContainer = document.createElement('div')
    Object.defineProperty(scrollContainer, 'scrollTop', { value: 0, writable: true })

    const { rerender, unmount } = render(
      <CommitGraphCanvas
        layout={canvasLayout([row('a'), row('b')])}
        scrollContainer={scrollContainer}
        viewportHeight={400}
        visibleSet={new Set(['a'])}
        railWidth={40}
        themeNonce={0}
        startIndex={0}
        endIndex={2}
        graphLayoutEndIndex={2}
      />
    )

    await vi.waitFor(() => {
      expect(strokeCount + fillCount).toBeGreaterThan(0)
    })
    const before = strokeCount + fillCount

    rerender(
      <CommitGraphCanvas
        layout={canvasLayout([row('a'), row('b')])}
        scrollContainer={scrollContainer}
        viewportHeight={400}
        visibleSet={new Set(['b'])}
        railWidth={40}
        themeNonce={0}
        startIndex={0}
        endIndex={2}
        graphLayoutEndIndex={2}
      />
    )

    await vi.waitFor(() => {
      expect(strokeCount + fillCount).toBeGreaterThan(before)
    })

    unmount()
  })

  it('batches edges per frame so stroke count stays within the palette across many rows', async () => {
    const scrollContainer = document.createElement('div')
    Object.defineProperty(scrollContainer, 'scrollTop', { value: 0, writable: true })
    const rows = Array.from({ length: 20 }, (_, index) => wideRow(`c${index}`))
    const boundaries = Array.from({ length: rows.length + 1 }, (_unused, index) =>
      Array.from({ length: 8 }, (_unusedLane, lane) => `c${index}-out-${lane}`)
    )

    render(
      <CommitGraphCanvas
        layout={canvasLayout(rows, boundaries)}
        scrollContainer={scrollContainer}
        viewportHeight={2000}
        visibleSet={null}
        railWidth={200}
        themeNonce={0}
        startIndex={0}
        endIndex={rows.length}
        graphLayoutEndIndex={rows.length}
      />
    )

    await vi.waitFor(() => {
      expect(fillCount).toBeGreaterThan(0)
    })

    expect(strokeCount).toBeLessThanOrEqual(LANE_PALETTE.length)
  })

  it('caps the bitmap width to the visible scroll container', () => {
    const scrollContainer = document.createElement('div')
    Object.defineProperty(scrollContainer, 'scrollTop', { value: 0, writable: true })
    Object.defineProperty(scrollContainer, 'clientWidth', { value: 300 })
    vi.stubGlobal('devicePixelRatio', 2)

    render(
      <CommitGraphCanvas
        layout={canvasLayout([row('a')])}
        scrollContainer={scrollContainer}
        viewportHeight={400}
        visibleSet={null}
        railWidth={2000}
        themeNonce={0}
        startIndex={0}
        endIndex={1}
        graphLayoutEndIndex={1}
      />
    )

    expect(screen.getByTestId('commit-graph-canvas')).toHaveAttribute('width', '600')
  })

  it('refreshes the bitmap scale proactively when devicePixelRatio changes', async () => {
    const scrollContainer = document.createElement('div')
    Object.defineProperty(scrollContainer, 'scrollTop', { value: 0, writable: true })
    Object.defineProperty(scrollContainer, 'clientWidth', { value: 100 })
    vi.stubGlobal('devicePixelRatio', 1)

    render(
      <CommitGraphCanvas
        layout={canvasLayout([row('a')])}
        scrollContainer={scrollContainer}
        viewportHeight={100}
        visibleSet={null}
        railWidth={100}
        themeNonce={0}
        startIndex={0}
        endIndex={1}
        graphLayoutEndIndex={1}
      />
    )
    const canvas = screen.getByTestId('commit-graph-canvas')
    expect(canvas).toHaveAttribute('width', '100')

    vi.stubGlobal('devicePixelRatio', 2)
    window.dispatchEvent(new Event('resize'))
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })

    expect(canvas).toHaveAttribute('width', '200')
  })

  it('redraws with live root metrics when the root font size changes', async () => {
    document.documentElement.style.fontSize = '16px'
    const scrollContainer = document.createElement('div')
    Object.defineProperty(scrollContainer, 'scrollTop', { value: 0, writable: true })
    const mergeRow = { ...row('merge'), commit: { ...entry('merge'), parents: ['a', 'b'] } }

    render(
      <CommitGraphCanvas
        layout={canvasLayout([mergeRow])}
        scrollContainer={scrollContainer}
        viewportHeight={100}
        visibleSet={null}
        railWidth={100}
        themeNonce={0}
        startIndex={0}
        endIndex={1}
        graphLayoutEndIndex={1}
      />
    )
    const initialRadius = arcRadii.at(-1) ?? 0

    document.documentElement.style.fontSize = '20px'
    window.dispatchEvent(new Event('resize'))
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })

    expect(arcRadii.at(-1)).toBeGreaterThan(initialRadius)
  })

  it('does not resolve CSS variables on every scroll frame, but refreshes them on theme change', async () => {
    const scrollContainer = document.createElement('div')
    Object.defineProperty(scrollContainer, 'scrollTop', { value: 0, writable: true })
    const getComputedStyleSpy = vi.spyOn(window, 'getComputedStyle')

    const { rerender } = render(
      <CommitGraphCanvas
        layout={canvasLayout([row('a'), row('b')])}
        scrollContainer={scrollContainer}
        viewportHeight={400}
        visibleSet={null}
        railWidth={40}
        themeNonce={0}
        startIndex={0}
        endIndex={2}
        graphLayoutEndIndex={2}
      />
    )

    await vi.waitFor(() => {
      expect(fillCount).toBeGreaterThan(0)
    })

    const afterSetup = getComputedStyleSpy.mock.calls.length

    for (let scrolls = 0; scrolls < 5; scrolls++) {
      scrollContainer.dispatchEvent(new Event('scroll'))
    }
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })

    expect(getComputedStyleSpy.mock.calls.length).toBe(afterSetup)

    rerender(
      <CommitGraphCanvas
        layout={canvasLayout([row('a'), row('b')])}
        scrollContainer={scrollContainer}
        viewportHeight={400}
        visibleSet={null}
        railWidth={40}
        themeNonce={1}
        startIndex={0}
        endIndex={2}
        graphLayoutEndIndex={2}
      />
    )

    await vi.waitFor(() => {
      expect(getComputedStyleSpy.mock.calls.length).toBeGreaterThan(afterSetup)
    })
  })

  it('skips rows beyond graphLayoutEndIndex', async () => {
    const scrollContainer = document.createElement('div')
    Object.defineProperty(scrollContainer, 'scrollTop', { value: 0, writable: true })

    render(
      <CommitGraphCanvas
        layout={canvasLayout([row('a'), row('b')])}
        scrollContainer={scrollContainer}
        viewportHeight={400}
        visibleSet={null}
        railWidth={40}
        themeNonce={0}
        startIndex={0}
        endIndex={2}
        graphLayoutEndIndex={1}
      />
    )

    await vi.waitFor(() => {
      expect(fillCount).toBeGreaterThan(0)
    })
    expect(strokeCount).toBeLessThan(4)
  })

  it('redraws when visible row graph geometry changes without changing row count', async () => {
    const scrollContainer = document.createElement('div')
    Object.defineProperty(scrollContainer, 'scrollTop', { value: 0, writable: true })
    const initialRows: RowLayout[] = [row('a'), row('b')]

    const { rerender } = render(
      <CommitGraphCanvas
        layout={canvasLayout(initialRows)}
        scrollContainer={scrollContainer}
        viewportHeight={400}
        visibleSet={null}
        railWidth={40}
        themeNonce={0}
        startIndex={0}
        endIndex={2}
        graphLayoutEndIndex={2}
      />
    )

    await vi.waitFor(() => {
      expect(fillCount).toBeGreaterThan(0)
    })
    const before = strokeCount + fillCount

    rerender(
      <CommitGraphCanvas
        layout={canvasLayout([row('a'), row('b')], [[], ['b'], []])}
        scrollContainer={scrollContainer}
        viewportHeight={400}
        visibleSet={null}
        railWidth={40}
        themeNonce={0}
        startIndex={0}
        endIndex={2}
        graphLayoutEndIndex={2}
      />
    )

    await vi.waitFor(() => {
      expect(strokeCount + fillCount).toBeGreaterThan(before)
    })
  })
})

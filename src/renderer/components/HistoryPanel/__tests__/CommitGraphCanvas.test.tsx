import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommitGraphCanvas } from '@/components/HistoryPanel/CommitGraphCanvas'
import { LANE_PALETTE } from '@/lib/git-graph/canvas'
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

function wideRow(hash: string): RowLayout {
  return {
    commit: entry(hash),
    commitLane: 0,
    incoming: [hash],
    outgoing: Array.from({ length: 8 }, (_, lane) => `${hash}-out-${lane}`)
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
    const scrollContainer = document.createElement('div')
    Object.defineProperty(scrollContainer, 'scrollTop', { value: 0, writable: true })

    const { rerender, unmount } = render(
      <CommitGraphCanvas
        rows={[row('a'), row('b')]}
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
        rows={[row('a'), row('b')]}
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

    render(
      <CommitGraphCanvas
        rows={rows}
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

  it('does not resolve CSS variables on every scroll frame, but refreshes them on theme change', async () => {
    const scrollContainer = document.createElement('div')
    Object.defineProperty(scrollContainer, 'scrollTop', { value: 0, writable: true })
    const getComputedStyleSpy = vi.spyOn(window, 'getComputedStyle')

    const { rerender } = render(
      <CommitGraphCanvas
        rows={[row('a'), row('b')]}
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
        rows={[row('a'), row('b')]}
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
        rows={[row('a'), row('b')]}
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
    const initialRows: RowLayout[] = [
      { ...row('a'), incoming: [], outgoing: [] },
      { ...row('b'), incoming: [], outgoing: [] }
    ]

    const { rerender } = render(
      <CommitGraphCanvas
        rows={initialRows}
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
        rows={[row('a'), row('b')]}
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

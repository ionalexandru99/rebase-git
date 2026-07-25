import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommitGraphCanvas } from '@/components/HistoryPanel/CommitGraphCanvas'
import { LANE_PALETTE } from '@/lib/git-graph/canvas'
import { layoutGraph } from '@/lib/git-graph/layout'
import { graphMetricsFor } from '@/lib/git-graph/metrics'
import { buildGraphTopology } from '@/lib/git-graph/topology'
import type { GitLogEntry } from '@/types'

const METRICS = graphMetricsFor(16)

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

function graphOf(commits: GitLogEntry[]) {
  const topology = buildGraphTopology(commits)
  return { commits, topology, layout: layoutGraph(topology) }
}

function scroller(overrides: { clientWidth?: number; scrollTop?: number } = {}) {
  const element = document.createElement('div')
  Object.defineProperty(element, 'scrollTop', { value: overrides.scrollTop ?? 0, writable: true })
  Object.defineProperty(element, 'clientWidth', {
    value: overrides.clientWidth ?? 400,
    writable: true
  })
  return element
}

function nextFrames(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

interface CanvasProps {
  graph: ReturnType<typeof graphOf>
  scrollContainer: HTMLDivElement
  viewportHeight?: number
  visibleSet?: Set<string> | null
  themeNonce?: number
  rowCount?: number
}

function renderCanvas(props: CanvasProps) {
  return (
    <CommitGraphCanvas
      layout={props.graph.layout}
      topology={props.graph.topology}
      commits={props.graph.commits}
      metrics={METRICS}
      scrollContainer={props.scrollContainer}
      viewportHeight={props.viewportHeight ?? 400}
      visibleSet={props.visibleSet ?? null}
      themeNonce={props.themeNonce ?? 0}
      rowCount={props.rowCount ?? props.graph.layout.commitCount}
    />
  )
}

describe('CommitGraphCanvas', () => {
  let strokeCount = 0
  let dotCount = 0
  let arcRadii: number[] = []
  let arcCenters: Array<{ x: number; y: number }> = []

  beforeEach(() => {
    strokeCount = 0
    dotCount = 0
    arcRadii = []
    arcCenters = []
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
      arc: vi.fn((x: number, y: number, radius: number) => {
        arcRadii.push(radius)
        arcCenters.push({ x, y })
      }),
      fill: vi.fn(() => {
        dotCount++
      })
    } as unknown as CanvasRenderingContext2D)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('draws a dot for every row on screen', async () => {
    const viewportHeight = METRICS.rowHeight * 5
    render(renderCanvas({ graph: graphOf(chain(50)), scrollContainer: scroller(), viewportHeight }))

    await vi.waitFor(() => {
      expect(dotCount).toBeGreaterThan(0)
    })
    expect(dotCount).toBeLessThanOrEqual(7)
  })

  it('draws the rows a live scroll reveals, without waiting for a re-render', async () => {
    const container = scroller()
    const graph = graphOf(chain(200))
    render(
      renderCanvas({ graph, scrollContainer: container, viewportHeight: METRICS.rowHeight * 4 })
    )
    await vi.waitFor(() => {
      expect(arcCenters.length).toBeGreaterThan(0)
    })

    arcCenters = []
    container.scrollTop = METRICS.rowHeight * 100
    container.dispatchEvent(new Event('scroll'))
    await nextFrames()

    // Row 100 now sits at the top of the viewport; nothing about the React props changed.
    expect(arcCenters.length).toBeGreaterThan(0)
    expect(Math.min(...arcCenters.map((center) => center.y))).toBeCloseTo(METRICS.rowHeight / 2, 5)
  })

  it('does not rebind scroll listeners when unrelated props change', async () => {
    const container = scroller()
    const graph = graphOf(chain(20))
    const addEventListener = vi.spyOn(container, 'addEventListener')
    const { rerender } = render(renderCanvas({ graph, scrollContainer: container }))
    await vi.waitFor(() => {
      expect(dotCount).toBeGreaterThan(0)
    })
    const boundOnMount = addEventListener.mock.calls.length

    rerender(renderCanvas({ graph, scrollContainer: container, visibleSet: new Set(['c1']) }))
    rerender(renderCanvas({ graph, scrollContainer: container, viewportHeight: 500 }))

    expect(addEventListener.mock.calls.length).toBe(boundOnMount)
  })

  it('coalesces a burst of scroll events into a single frame', async () => {
    const container = scroller()
    const graph = graphOf(chain(200))
    render(renderCanvas({ graph, scrollContainer: container }))
    await vi.waitFor(() => {
      expect(dotCount).toBeGreaterThan(0)
    })

    dotCount = 0
    for (let scrolls = 0; scrolls < 5; scrolls++) {
      container.scrollTop = METRICS.rowHeight * scrolls
      container.dispatchEvent(new Event('scroll'))
    }
    await nextFrames()
    const afterBurst = dotCount

    container.dispatchEvent(new Event('scroll'))
    await nextFrames()

    expect(afterBurst).toBeGreaterThan(0)
    expect(dotCount).toBe(afterBurst * 2)
  })

  it('redraws when the visible filter set changes', async () => {
    const container = scroller()
    const graph = graphOf(chain(4))
    const { rerender } = render(
      renderCanvas({ graph, scrollContainer: container, visibleSet: new Set(['c0']) })
    )
    await vi.waitFor(() => {
      expect(dotCount).toBeGreaterThan(0)
    })
    const before = dotCount

    rerender(renderCanvas({ graph, scrollContainer: container, visibleSet: new Set(['c1']) }))
    await nextFrames()

    expect(dotCount).toBeGreaterThan(before)
  })

  it('batches edges per frame so stroke count stays within the palette', async () => {
    const container = scroller()
    const wide = graphOf([
      entry(
        'm',
        Array.from({ length: 12 }, (_unused, lane) => `p${lane}`)
      ),
      ...Array.from({ length: 12 }, (_unused, lane) => entry(`p${lane}`, []))
    ])
    render(renderCanvas({ graph: wide, scrollContainer: container }))

    await vi.waitFor(() => {
      expect(dotCount).toBeGreaterThan(0)
    })

    // One stroke per lane colour for all edges, plus at most one merge ring per drawn row.
    expect(strokeCount).toBeLessThanOrEqual(LANE_PALETTE.length + 13)
  })

  it('sizes the rail to the lanes the visible rows actually use', async () => {
    const container = scroller()
    const wide = graphOf([
      entry('m', ['p0', 'p1', 'p2', 'p3']),
      ...Array.from({ length: 4 }, (_unused, lane) => entry(`p${lane}`, []))
    ])
    render(renderCanvas({ graph: wide, scrollContainer: container, viewportHeight: 400 }))
    await vi.waitFor(() => {
      expect(dotCount).toBeGreaterThan(0)
    })
    const wideRail = screen.getByTestId('commit-graph-canvas').style.width

    render(renderCanvas({ graph: graphOf(chain(3)), scrollContainer: scroller() }))
    await vi.waitFor(() => {
      expect(dotCount).toBeGreaterThan(0)
    })
    const narrowRail = screen.getAllByTestId('commit-graph-canvas')[1].style.width

    expect(parseFloat(wideRail)).toBeGreaterThan(parseFloat(narrowRail))
  })

  it('caps the bitmap width to the visible scroll container', () => {
    vi.stubGlobal('devicePixelRatio', 2)
    const narrow = scroller({ clientWidth: 12 })
    render(renderCanvas({ graph: graphOf(chain(3)), scrollContainer: narrow }))

    expect(screen.getByTestId('commit-graph-canvas')).toHaveAttribute('width', '24')
  })

  it('refreshes the bitmap scale when devicePixelRatio changes', async () => {
    vi.stubGlobal('devicePixelRatio', 1)
    render(
      renderCanvas({
        graph: graphOf(chain(1)),
        scrollContainer: scroller({ clientWidth: 10 }),
        viewportHeight: 100
      })
    )
    const canvas = screen.getByTestId('commit-graph-canvas')
    expect(canvas).toHaveAttribute('width', '10')

    vi.stubGlobal('devicePixelRatio', 2)
    window.dispatchEvent(new Event('resize'))
    await nextFrames()

    expect(canvas).toHaveAttribute('width', '20')
  })

  it('resolves CSS variables only when the theme changes, never per scroll frame', async () => {
    const container = scroller()
    const graph = graphOf(chain(20))
    const getComputedStyleSpy = vi.spyOn(window, 'getComputedStyle')
    const { rerender } = render(renderCanvas({ graph, scrollContainer: container }))
    await vi.waitFor(() => {
      expect(dotCount).toBeGreaterThan(0)
    })
    const afterSetup = getComputedStyleSpy.mock.calls.length

    for (let scrolls = 0; scrolls < 5; scrolls++) {
      container.dispatchEvent(new Event('scroll'))
    }
    await nextFrames()

    expect(getComputedStyleSpy.mock.calls.length).toBe(afterSetup)

    rerender(renderCanvas({ graph, scrollContainer: container, themeNonce: 1 }))
    await nextFrames()

    expect(getComputedStyleSpy.mock.calls.length).toBeGreaterThan(afterSetup)
  })

  it('never draws past the rows that have a valid layout', async () => {
    const container = scroller()
    const graph = graphOf(chain(10))
    render(renderCanvas({ graph, scrollContainer: container, rowCount: 2 }))

    await vi.waitFor(() => {
      expect(dotCount).toBeGreaterThan(0)
    })

    expect(dotCount).toBe(2)
  })
})

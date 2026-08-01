import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommitGraphCanvas } from '@/features/history/CommitGraphCanvas'
import { LANE_PALETTE } from '@/features/history/graph/canvas'
import { layoutGraph } from '@/features/history/graph/layout'
import { graphMetricsFor } from '@/features/history/graph/metrics'
import { buildGraphTopology } from '@/features/history/graph/topology'
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

function expandedMergeHistory(): GitLogEntry[] {
  const mergeRow = 120
  const sideLength = 3
  const commits: GitLogEntry[] = []
  for (let index = 0; index < mergeRow; index++) {
    commits.push(entry(`c${index}`, [`c${index + 1}`]))
  }
  commits.push(entry(`c${mergeRow}`, [`c${mergeRow + 1}`, 's0']))
  for (let index = 0; index < sideLength; index++) {
    commits.push(
      entry(`s${index}`, [index < sideLength - 1 ? `s${index + 1}` : `c${mergeRow + 4}`])
    )
  }
  for (let index = mergeRow + 1; index < 200; index++) {
    commits.push(entry(`c${index}`, index < 199 ? [`c${index + 1}`] : []))
  }
  return commits
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
  rowCount?: number
  paddingStart?: number
  headRow?: number
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
      rowCount={props.rowCount ?? props.graph.layout.commitCount}
      paddingStart={props.paddingStart}
      headRow={props.headRow}
    />
  )
}

describe('CommitGraphCanvas', () => {
  let strokeCount = 0
  let dotCount = 0
  let arcRadii: number[] = []
  let arcCenters: Array<{ x: number; y: number }> = []
  let dashPatterns: number[][] = []
  let segments: Array<{ startX: number; startY: number; endX: number; endY: number }> = []
  let penX = 0
  let penY = 0

  beforeEach(() => {
    strokeCount = 0
    dotCount = 0
    arcRadii = []
    arcCenters = []
    dashPatterns = []
    segments = []
    penX = 0
    penY = 0
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn((x: number, y: number) => {
        penX = x
        penY = y
      }),
      lineTo: vi.fn((x: number, y: number) => {
        segments.push({ startX: penX, startY: penY, endX: x, endY: y })
        penX = x
        penY = y
      }),
      bezierCurveTo: vi.fn(
        (_c1x: number, _c1y: number, _c2x: number, _c2y: number, x: number, y: number) => {
          segments.push({ startX: penX, startY: penY, endX: x, endY: y })
          penX = x
          penY = y
        }
      ),
      stroke: vi.fn(() => {
        strokeCount++
      }),
      arc: vi.fn((x: number, y: number, radius: number) => {
        arcRadii.push(radius)
        arcCenters.push({ x, y })
      }),
      fill: vi.fn(() => {
        dotCount++
      }),
      setLineDash: vi.fn((pattern: number[]) => {
        dashPatterns.push(pattern)
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

  it('drops every row by the height of the pinned working-copy row', async () => {
    const paddingStart = 44
    render(
      renderCanvas({
        graph: graphOf(chain(5)),
        scrollContainer: scroller(),
        viewportHeight: METRICS.rowHeight * 5,
        paddingStart
      })
    )

    await vi.waitFor(() => {
      expect(arcCenters.length).toBeGreaterThan(0)
    })
    expect(Math.min(...arcCenters.map((center) => center.y))).toBeCloseTo(
      paddingStart + METRICS.rowHeight / 2,
      5
    )
  })

  it('runs a dashed stub from the pinned row into the HEAD dot', async () => {
    render(
      renderCanvas({
        graph: graphOf(chain(5)),
        scrollContainer: scroller(),
        viewportHeight: METRICS.rowHeight * 5,
        paddingStart: 44,
        headRow: 1
      })
    )

    await vi.waitFor(() => {
      expect(dashPatterns.length).toBeGreaterThan(0)
    })
    expect(dashPatterns.some((pattern) => pattern.length > 0)).toBe(true)
    expect(dashPatterns.at(-1)).toEqual([])
  })

  it('leaves the graph solid when nothing is pinned above it', async () => {
    render(renderCanvas({ graph: graphOf(chain(5)), scrollContainer: scroller() }))

    await vi.waitFor(() => {
      expect(dotCount).toBeGreaterThan(0)
    })
    expect(dashPatterns).toEqual([])
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

  it('resolves CSS variables once at setup, never per scroll frame', async () => {
    const container = scroller()
    const graph = graphOf(chain(20))
    const getComputedStyleSpy = vi.spyOn(window, 'getComputedStyle')
    render(renderCanvas({ graph, scrollContainer: container }))
    await vi.waitFor(() => {
      expect(dotCount).toBeGreaterThan(0)
    })
    const afterSetup = getComputedStyleSpy.mock.calls.length

    for (let scrolls = 0; scrolls < 5; scrolls++) {
      container.dispatchEvent(new Event('scroll'))
    }
    await nextFrames()

    expect(getComputedStyleSpy.mock.calls.length).toBe(afterSetup)
  })

  it('never draws past the commits it was handed, even with a stale row count', async () => {
    const container = scroller()
    const graph = graphOf(chain(20))

    expect(() =>
      render(
        renderCanvas({
          graph: { ...graph, commits: graph.commits.slice(0, 3) },
          scrollContainer: container
        })
      )
    ).not.toThrow()

    await vi.waitFor(() => {
      expect(dotCount).toBeGreaterThan(0)
    })
    expect(dotCount).toBe(3)
  })

  it('joins every visible row to its parent row, across an expanded merge and a checkpoint', async () => {
    const graph = graphOf(expandedMergeHistory())
    const paddingStart = 44
    const scrollTop = paddingStart + METRICS.rowHeight * 115
    const viewportHeight = METRICS.rowHeight * 20
    render(
      renderCanvas({
        graph,
        scrollContainer: scroller({ scrollTop }),
        viewportHeight,
        paddingStart,
        headRow: 0
      })
    )
    await vi.waitFor(() => {
      expect(arcCenters.length).toBeGreaterThan(0)
    })

    const rowOfDot = new Map<number, { x: number; y: number }>()
    for (const center of arcCenters) {
      const row = Math.round(
        (center.y + scrollTop - paddingStart - METRICS.rowHeight / 2) / METRICS.rowHeight
      )
      rowOfDot.set(row, center)
    }

    const gaps: string[] = []
    for (const [row, dot] of rowOfDot) {
      const child = graph.commits[row]
      const next = graph.commits[row + 1]
      const below = rowOfDot.get(row + 1)
      if (!next || !below || !child.parents.includes(next.hash)) {
        continue
      }
      const leavesDot = segments.some(
        (segment) =>
          Math.abs(segment.startX - dot.x) < 0.01 &&
          Math.abs(segment.startY - dot.y) < 0.01 &&
          segment.endY >= dot.y + METRICS.rowHeight / 2 - 0.01
      )
      const reachesDot = segments.some(
        (segment) =>
          Math.abs(segment.endX - below.x) < 0.01 &&
          Math.abs(segment.endY - below.y) < 0.01 &&
          segment.startY <= below.y - METRICS.rowHeight / 2 + 0.01
      )
      if (!leavesDot || !reachesDot) {
        gaps.push(`${child.hash} -> ${next.hash}`)
      }
    }

    expect(rowOfDot.size).toBeGreaterThan(15)
    expect(gaps).toEqual([])
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

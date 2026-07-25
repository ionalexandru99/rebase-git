import { describe, expect, it, vi } from 'vitest'
import {
  collectRowEdges,
  createEdgeBatch,
  drawCommitDot,
  drawMergeGlyph,
  edgeBatchCapacity,
  LANE_PALETTE,
  laneColor,
  laneX as laneXAt,
  resetEdgeBatch,
  strokeEdgeBatch
} from '@/features/history/graph/canvas'
import {
  createLaneWalker,
  type LaneWalker,
  seekLanes,
  stepLanes
} from '@/features/history/graph/lane-walker'
import { type GraphLayout, layoutGraph } from '@/features/history/graph/layout'
import { graphMetricsFor } from '@/features/history/graph/metrics'
import { buildGraphTopology, type GraphTopology } from '@/features/history/graph/topology'
import type { GitLogEntry } from '@/types'

const METRICS = graphMetricsFor(16)
const ROW_H = METRICS.rowHeight

function laneX(lane: number): number {
  return laneXAt(lane, METRICS)
}

function commit(hash: string, parents: string[]): GitLogEntry {
  return {
    hash,
    message: hash,
    author_name: 'Author',
    date: '2024-01-01T00:00:00.000Z',
    parents,
    refs: ''
  }
}

interface Graph {
  layout: GraphLayout
  topology: GraphTopology
  commits: GitLogEntry[]
}

function graphOf(commits: GitLogEntry[]): Graph {
  const topology = buildGraphTopology(commits)
  return { layout: layoutGraph(topology), topology, commits }
}

function walkerAt(graph: Graph, row: number): LaneWalker {
  const walker = createLaneWalker()
  seekLanes(walker, graph.layout, graph.topology, row)
  stepLanes(walker, graph.topology)
  return walker
}

// The edge half of a frame: every segment of a row collected, then stroked in one batched pass.
function strokeRowEdges(ctx: CanvasRenderingContext2D, graph: Graph, row: number): void {
  const batch = createEdgeBatch()
  collectRowEdges(batch, walkerAt(graph, row), graph.topology, row, 0, false, METRICS)
  strokeEdgeBatch(ctx, batch)
}

// One row of the panel's per-frame pipeline: collect edges, stroke them once, then place the dot.
function drawRow(ctx: CanvasRenderingContext2D, graph: Graph, row: number, dim = false): void {
  const batch = createEdgeBatch()
  collectRowEdges(batch, walkerAt(graph, row), graph.topology, row, 0, dim, METRICS)
  strokeEdgeBatch(ctx, batch)
  drawCommitDot(
    ctx,
    graph.layout.commitLane[row],
    graph.commits[row].parents.length >= 2,
    0,
    dim,
    '#000000',
    METRICS
  )
}

function mockCtx() {
  const lineWidths: number[] = []
  const arcRadii: number[] = []
  const ctx = {
    globalAlpha: 1,
    strokeStyle: '',
    fillStyle: '',
    set lineWidth(value: number) {
      lineWidths.push(value)
    },
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn((_x: number, _y: number, radius: number) => {
      arcRadii.push(radius)
    })
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, lineWidths, arcRadii, raw: ctx }
}

type EdgeSubpath = string

function recordingCtx() {
  const commands: Array<{ op: 'moveTo' | 'lineTo' | 'bezierCurveTo'; args: number[] }> = []
  const record =
    (op: 'moveTo' | 'lineTo' | 'bezierCurveTo') =>
    (...args: number[]) => {
      commands.push({ op, args })
    }
  const ctx = {
    globalAlpha: 1,
    strokeStyle: '',
    fillStyle: '',
    set lineWidth(_value: number) {},
    beginPath: vi.fn(),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    bezierCurveTo: record('bezierCurveTo'),
    stroke: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn()
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, commands }
}

function collectSubpaths(commands: Array<{ op: string; args: number[] }>): EdgeSubpath[] {
  const subpaths: EdgeSubpath[] = []
  for (let i = 0; i < commands.length; i++) {
    if (commands[i].op !== 'moveTo') {
      continue
    }
    const start = commands[i].args
    const next = commands[i + 1]
    subpaths.push(`${next.op}(${start.join(',')}->${next.args.join(',')})`)
  }
  return subpaths.sort()
}

function strokeStyleRecorder() {
  const strokeStyles: string[] = []
  const ctx = {
    globalAlpha: 1,
    strokeStyle: '',
    fillStyle: '',
    set lineWidth(_value: number) {},
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(() => {
      strokeStyles.push((ctx as { strokeStyle: string }).strokeStyle)
    })
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, strokeStyles }
}

describe('drawCommitDot', () => {
  it('strokes a merge ring in the lane color of the branch', () => {
    const { ctx, strokeStyles } = strokeStyleRecorder()

    drawCommitDot(ctx, 2, true, 0, false, '#000000', METRICS)

    expect(strokeStyles).toContain(laneColor(2))
  })

  it('renders the merge node as a root-size-scaled ring, not a hardcoded size', () => {
    const { ctx, arcRadii, lineWidths } = mockCtx()

    drawCommitDot(ctx, 0, true, 0, false, '#000000', METRICS)

    expect(arcRadii).toContain(METRICS.mergeDotRadius)
    expect(lineWidths).toContain(METRICS.mergeStroke)
  })

  it('renders a non-merge commit as a solid dot, not a merge ring', () => {
    const { ctx, arcRadii } = mockCtx()

    drawCommitDot(ctx, 0, false, 0, false, '#000000', METRICS)

    expect(arcRadii).not.toContain(METRICS.mergeDotRadius)
  })
})

describe('collectRowEdges', () => {
  it('draws an edge to each diverging parent of an octopus merge', () => {
    const { ctx, raw } = mockCtx()
    const graph = graphOf([
      commit('m', ['p1', 'p2', 'p3']),
      commit('p1', []),
      commit('p2', []),
      commit('p3', [])
    ])

    drawRow(ctx, graph, 0)

    // p2 and p3 fan out into freshly opened lanes, each drawn as a bezier from the merge dot.
    expect(raw.bezierCurveTo.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('batches edge strokes by lane color so stroke count never exceeds the palette', () => {
    const { ctx, raw } = mockCtx()
    const graph = graphOf([
      commit(
        'c',
        Array.from({ length: 16 }, (_unused, lane) => `p${lane}`)
      ),
      ...Array.from({ length: 16 }, (_unused, lane) => commit(`p${lane}`, []))
    ])

    strokeRowEdges(ctx, graph, 0)

    expect(raw.stroke.mock.calls.length).toBeLessThanOrEqual(LANE_PALETTE.length)
  })

  it('does not add strokes when more same-color segments are drawn', () => {
    const fanOut = (lanes: number) =>
      graphOf([
        commit(
          'c',
          Array.from({ length: lanes }, (_unused, lane) => `p${lane}`)
        ),
        ...Array.from({ length: lanes }, (_unused, lane) => commit(`p${lane}`, []))
      ])

    const eightLanes = mockCtx()
    strokeRowEdges(eightLanes.ctx, fanOut(8), 0)
    const sixteenLanes = mockCtx()
    strokeRowEdges(sixteenLanes.ctx, fanOut(16), 0)

    expect(sixteenLanes.raw.stroke.mock.calls.length).toBe(eightLanes.raw.stroke.mock.calls.length)
  })

  it('emits identical edge control points for pass-through, branch-in, and diverging segments', () => {
    const { ctx, commands } = recordingCtx()
    // Row 1 sits in lane 1 with lane 0 passing through, its first parent staying in lane 1 and its
    // second parent diverging into a freshly opened lane 2.
    const graph = graphOf([
      commit('a', ['x', 'c']),
      commit('c', ['p1', 'p2']),
      commit('x', []),
      commit('p1', []),
      commit('p2', [])
    ])

    expect(graph.layout.commitLane[1]).toBe(1)
    drawRow(ctx, graph, 1)

    const rowMid = ROW_H / 2
    const rowBot = ROW_H
    const quarter = ROW_H / 4
    const expected = collectSubpaths([
      { op: 'moveTo', args: [laneX(0), 0] },
      { op: 'lineTo', args: [laneX(0), rowMid] },
      { op: 'moveTo', args: [laneX(1), 0] },
      { op: 'lineTo', args: [laneX(1), rowMid] },
      { op: 'moveTo', args: [laneX(0), rowMid] },
      { op: 'lineTo', args: [laneX(0), rowBot] },
      { op: 'moveTo', args: [laneX(1), rowMid] },
      { op: 'lineTo', args: [laneX(1), rowBot] },
      { op: 'moveTo', args: [laneX(1), rowMid] },
      {
        op: 'bezierCurveTo',
        args: [laneX(1), rowMid + quarter, laneX(2), rowMid + quarter, laneX(2), rowBot]
      }
    ])

    expect(collectSubpaths(commands)).toEqual(expected)
  })

  it('skips the incoming boundary on the very first row', () => {
    const { ctx, commands } = recordingCtx()
    const graph = graphOf([commit('a', ['b']), commit('b', [])])

    drawRow(ctx, graph, 0)

    expect(commands.every((command) => command.args[1] >= ROW_H / 2)).toBe(true)
  })

  it('reuses retained edge segment capacity across draw frames', () => {
    const batch = createEdgeBatch()
    const graph = graphOf([commit('c', ['p1', 'p2']), commit('p1', []), commit('p2', [])])

    collectRowEdges(batch, walkerAt(graph, 0), graph.topology, 0, 0, false, METRICS)
    const firstFrameCapacity = edgeBatchCapacity(batch)
    resetEdgeBatch(batch)
    collectRowEdges(batch, walkerAt(graph, 0), graph.topology, 0, 0, false, METRICS)

    expect(firstFrameCapacity).toBeGreaterThan(0)
    expect(edgeBatchCapacity(batch)).toBe(firstFrameCapacity)
  })
})

describe('drawMergeGlyph', () => {
  it('draws a plus glyph (horizontal + vertical arm) for a collapsed merge', () => {
    const { ctx, commands } = recordingCtx()
    drawMergeGlyph(ctx, 12, 24, 'collapsed', '#ffffff', METRICS)
    expect(commands.filter((command) => command.op === 'lineTo').length).toBe(2)
  })

  it('draws a minus glyph (single horizontal arm) for an expanded merge', () => {
    const { ctx, commands } = recordingCtx()
    drawMergeGlyph(ctx, 12, 24, 'expanded', '#ffffff', METRICS)
    expect(commands.filter((command) => command.op === 'lineTo').length).toBe(1)
  })
})

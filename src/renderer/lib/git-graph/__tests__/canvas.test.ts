import { describe, expect, it, vi } from 'vitest'
import {
  collectRowEdges,
  createEdgeBatch,
  drawCommitDot,
  drawGraphRow,
  drawMergeGlyph,
  edgeBatchCapacity,
  LANE_PALETTE,
  laneColor,
  laneX,
  MERGE_DOT_R,
  MERGE_STROKE,
  ROW_H,
  resetEdgeBatch
} from '@/lib/git-graph/canvas'
import type { RowLayout } from '@/lib/git-graph/layout'
import type { GitLogEntry } from '@/types'

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
    const row: RowLayout = {
      commit: commit('m', ['p1', 'p2']),
      commitLane: 2
    }

    drawCommitDot(ctx, row, 0, false, '#000000')

    expect(strokeStyles).toContain(laneColor(2))
  })
})

describe('drawGraphRow', () => {
  it('draws an edge to each diverging parent of an octopus merge', () => {
    const { ctx, raw } = mockCtx()
    const row: RowLayout = {
      commit: commit('m', ['p1', 'p2', 'p3']),
      commitLane: 0
    }

    drawGraphRow(ctx, row, ['m', null, null], ['p1', 'p2', 'p3'], 0, false, false, '#000000')

    // p2 and p3 fan out into freshly opened lanes, each drawn as a bezier from the merge dot.
    expect(raw.bezierCurveTo.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('renders the merge node as a ROOT_PX-scaled ring, not a hardcoded size', () => {
    const { ctx, arcRadii, lineWidths } = mockCtx()
    const row: RowLayout = {
      commit: commit('m', ['p1', 'p2']),
      commitLane: 0
    }

    drawGraphRow(ctx, row, ['m'], ['p1', 'p2'], 0, false, false, '#000000')

    expect(arcRadii).toContain(MERGE_DOT_R)
    expect(lineWidths).toContain(MERGE_STROKE)
  })

  it('batches edge strokes by lane color so stroke count never exceeds the palette', () => {
    const { ctx, raw } = mockCtx()
    const wideOutgoing = Array.from({ length: 16 }, (_, lane) => `p${lane}`)
    const row: RowLayout = {
      commit: commit('c', []),
      commitLane: 0
    }

    drawGraphRow(ctx, row, ['c'], wideOutgoing, 0, false, false, '#000000')

    expect(raw.stroke.mock.calls.length).toBeLessThanOrEqual(LANE_PALETTE.length)
  })

  it('does not add strokes when more same-color segments are drawn', () => {
    const eightLanes = mockCtx()
    drawGraphRow(
      eightLanes.ctx,
      {
        commit: commit('c', []),
        commitLane: 0
      },
      ['c'],
      Array.from({ length: 8 }, (_, lane) => `p${lane}`),
      0,
      false,
      false,
      '#000000'
    )

    const sixteenLanes = mockCtx()
    drawGraphRow(
      sixteenLanes.ctx,
      {
        commit: commit('c', []),
        commitLane: 0
      },
      ['c'],
      Array.from({ length: 16 }, (_, lane) => `p${lane}`),
      0,
      false,
      false,
      '#000000'
    )

    expect(sixteenLanes.raw.stroke.mock.calls.length).toBe(eightLanes.raw.stroke.mock.calls.length)
  })

  it('emits identical edge control points for pass-through, branch-in, and diverging segments', () => {
    const { ctx, commands } = recordingCtx()
    const row: RowLayout = {
      commit: commit('c', ['p1', 'p2']),
      commitLane: 1
    }

    drawGraphRow(ctx, row, ['x', 'c', null], ['x', 'p1', 'p2'], 0, false, false, '#000000')

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

  it('draws a plus glyph (horizontal + vertical arm) for a collapsed merge', () => {
    const { ctx, commands } = recordingCtx()
    drawMergeGlyph(ctx, 12, 24, 'collapsed', '#ffffff')
    const armCount = commands.filter((command) => command.op === 'lineTo').length
    expect(armCount).toBe(2)
  })

  it('draws a minus glyph (single horizontal arm) for an expanded merge', () => {
    const { ctx, commands } = recordingCtx()
    drawMergeGlyph(ctx, 12, 24, 'expanded', '#ffffff')
    const armCount = commands.filter((command) => command.op === 'lineTo').length
    expect(armCount).toBe(1)
  })

  it('renders a non-merge commit as a solid dot, not a merge ring', () => {
    const { ctx, arcRadii } = mockCtx()
    const row: RowLayout = {
      commit: commit('c', ['p']),
      commitLane: 0
    }

    drawGraphRow(ctx, row, ['c'], ['p'], 0, false, false, '#000000')

    expect(arcRadii).not.toContain(MERGE_DOT_R)
  })

  it('reuses retained edge segment capacity across draw frames', () => {
    const batch = createEdgeBatch()
    const row: RowLayout = { commit: commit('c', ['p1', 'p2']), commitLane: 0 }

    collectRowEdges(batch, row, ['c'], ['p1', 'p2'], 0, false, false)
    const firstFrameCapacity = edgeBatchCapacity(batch)
    resetEdgeBatch(batch)
    collectRowEdges(batch, row, ['c'], ['p1', 'p2'], 0, false, false)

    expect(firstFrameCapacity).toBeGreaterThan(0)
    expect(edgeBatchCapacity(batch)).toBe(firstFrameCapacity)
  })
})

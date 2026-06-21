import { describe, expect, it, vi } from 'vitest'
import { drawGraphRow, MERGE_DOT_R, MERGE_STROKE } from '@/lib/git-graph/canvas'
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

describe('drawGraphRow', () => {
  it('draws an edge to each diverging parent of an octopus merge', () => {
    const { ctx, raw } = mockCtx()
    const row: RowLayout = {
      commit: commit('m', ['p1', 'p2', 'p3']),
      commitLane: 0,
      incoming: ['m', null, null],
      outgoing: ['p1', 'p2', 'p3']
    }

    drawGraphRow(ctx, row, 0, false, false, '#000000', '#ffffff')

    // p2 and p3 fan out into freshly opened lanes, each drawn as a bezier from the merge dot.
    expect(raw.bezierCurveTo.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('renders the merge node as a ROOT_PX-scaled ring, not a hardcoded size', () => {
    const { ctx, arcRadii, lineWidths } = mockCtx()
    const row: RowLayout = {
      commit: commit('m', ['p1', 'p2']),
      commitLane: 0,
      incoming: ['m'],
      outgoing: ['p1', 'p2']
    }

    drawGraphRow(ctx, row, 0, false, false, '#000000', '#ffffff')

    expect(arcRadii).toContain(MERGE_DOT_R)
    expect(lineWidths).toContain(MERGE_STROKE)
  })

  it('renders a non-merge commit as a solid dot, not a merge ring', () => {
    const { ctx, arcRadii } = mockCtx()
    const row: RowLayout = {
      commit: commit('c', ['p']),
      commitLane: 0,
      incoming: ['c'],
      outgoing: ['p']
    }

    drawGraphRow(ctx, row, 0, false, false, '#000000', '#ffffff')

    expect(arcRadii).not.toContain(MERGE_DOT_R)
  })
})

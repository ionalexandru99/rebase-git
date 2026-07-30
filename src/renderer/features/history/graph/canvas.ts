import type { LaneWalker } from './lane-walker'
import { indexOfOwner } from './lanes'
import type { GraphMetrics } from './metrics'
import { EMPTY_LANE, type GraphTopology } from './topology'

export const LANE_PALETTE = [
  '#7c8cff',
  '#5fb4e4',
  '#e6804c',
  '#6ec48a',
  '#c97cd1',
  '#d9c356',
  '#6dd2c4',
  '#e36c8f'
]

export function laneColor(lane: number): string {
  return LANE_PALETTE[lane % LANE_PALETTE.length]
}

export function laneX(lane: number, metrics: GraphMetrics): number {
  return metrics.railPadding + lane * metrics.columnWidth
}

export function computeGraphRailWidth(maxLanes: number, metrics: GraphMetrics): number {
  return metrics.railPadding * 2 + Math.max(maxLanes - 1, 0) * metrics.columnWidth
}

export function readCssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') {
    return fallback
  }
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

interface EdgeSegment {
  startX: number
  startY: number
  controlX1: number
  controlY1: number
  controlX2: number
  controlY2: number
  endX: number
  endY: number
  curved: boolean
}

interface EdgeGroup {
  strokeStyle: string
  alpha: number
  segments: EdgeSegment[]
  used: number
}

export interface EdgeBatch {
  groups: EdgeGroup[]
}

export function createEdgeBatch(): EdgeBatch {
  const groups: EdgeGroup[] = []
  for (const alpha of [0.85, 0.2]) {
    for (const strokeStyle of LANE_PALETTE) {
      groups.push({ strokeStyle, alpha, segments: [], used: 0 })
    }
  }
  return { groups }
}

export function resetEdgeBatch(batch: EdgeBatch): void {
  for (const group of batch.groups) {
    group.used = 0
  }
}

export function edgeBatchCapacity(batch: EdgeBatch): number {
  let capacity = 0
  for (const group of batch.groups) {
    capacity += group.segments.length
  }
  return capacity
}

function addEdge(
  batch: EdgeBatch,
  lane: number,
  dim: boolean,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  controlX1?: number,
  controlY1?: number,
  controlX2?: number,
  controlY2?: number
): void {
  const group = batch.groups[(dim ? LANE_PALETTE.length : 0) + (lane % LANE_PALETTE.length)]
  const index = group.used++
  const segment = group.segments[index] ?? {
    startX: 0,
    startY: 0,
    controlX1: 0,
    controlY1: 0,
    controlX2: 0,
    controlY2: 0,
    endX: 0,
    endY: 0,
    curved: false
  }
  segment.startX = startX
  segment.startY = startY
  segment.endX = endX
  segment.endY = endY
  segment.curved = controlX1 !== undefined
  segment.controlX1 = controlX1 ?? 0
  segment.controlY1 = controlY1 ?? 0
  segment.controlX2 = controlX2 ?? 0
  segment.controlY2 = controlY2 ?? 0
  if (index === group.segments.length) {
    group.segments.push(segment)
  }
}

export function collectRowEdges(
  batch: EdgeBatch,
  walker: LaneWalker,
  topology: GraphTopology,
  row: number,
  yTop: number,
  dim: boolean,
  metrics: GraphMetrics
): void {
  const incoming = walker.incoming
  const incomingLanes = walker.incomingCount
  const outgoing = walker.lanes
  const outgoingLanes = walker.laneCount

  const commitLane = walker.commitLane
  const rowMid = yTop + metrics.rowHeight / 2
  const rowBottom = yTop + metrics.rowHeight
  const dotX = laneX(commitLane, metrics)
  const curveOffset = metrics.rowHeight / 4

  if (row > 0) {
    for (let lane = 0; lane < incomingLanes; lane++) {
      if (incoming[lane] === EMPTY_LANE) {
        continue
      }
      const startX = laneX(lane, metrics)
      addEdge(batch, lane, dim, startX, yTop, startX, rowMid)
    }
  }

  for (let lane = 0; lane < outgoingLanes; lane++) {
    const owner = outgoing[lane]
    if (owner === EMPTY_LANE) {
      continue
    }
    const endX = laneX(lane, metrics)
    const passesThrough = lane < incomingLanes && incoming[lane] === owner
    if (passesThrough || dotX === endX) {
      addEdge(batch, lane, dim, passesThrough ? endX : dotX, rowMid, endX, rowBottom)
      continue
    }
    addEdge(
      batch,
      lane,
      dim,
      dotX,
      rowMid,
      endX,
      rowBottom,
      dotX,
      rowMid + curveOffset,
      endX,
      rowMid + curveOffset
    )
  }

  const parentStart = topology.parentOffsets[row - topology.firstRow]
  const parentEnd = topology.parentOffsets[row - topology.firstRow + 1]
  for (let offset = parentStart; offset < parentEnd; offset++) {
    const parent = topology.parentIds[offset]
    const lane = indexOfOwner(outgoing, outgoingLanes, parent)
    if (lane === -1 || lane === commitLane || lane >= incomingLanes) {
      continue
    }
    if (incoming[lane] !== parent) {
      continue
    }
    const endX = laneX(lane, metrics)
    addEdge(
      batch,
      lane,
      dim,
      dotX,
      rowMid,
      endX,
      rowBottom,
      dotX,
      rowMid + curveOffset,
      endX,
      rowMid + curveOffset
    )
  }
}

export function strokeEdgeBatch(ctx: CanvasRenderingContext2D, batch: EdgeBatch): void {
  ctx.lineWidth = 2
  for (const group of batch.groups) {
    if (group.used === 0) {
      continue
    }
    ctx.globalAlpha = group.alpha
    ctx.strokeStyle = group.strokeStyle
    ctx.beginPath()
    for (let index = 0; index < group.used; index++) {
      const segment = group.segments[index]
      ctx.moveTo(segment.startX, segment.startY)
      if (segment.curved) {
        ctx.bezierCurveTo(
          segment.controlX1,
          segment.controlY1,
          segment.controlX2,
          segment.controlY2,
          segment.endX,
          segment.endY
        )
      } else {
        ctx.lineTo(segment.endX, segment.endY)
      }
    }
    ctx.stroke()
  }
}

export function drawCommitDot(
  ctx: CanvasRenderingContext2D,
  lane: number,
  isMerge: boolean,
  yTop: number,
  dim: boolean,
  bgColor: string,
  metrics: GraphMetrics
): void {
  const rowMid = yTop + metrics.rowHeight / 2
  const dotX = laneX(lane, metrics)
  if (isMerge) {
    ctx.globalAlpha = dim ? 0.25 : 0.95
    ctx.beginPath()
    ctx.arc(dotX, rowMid, metrics.mergeDotRadius, 0, Math.PI * 2)
    ctx.fillStyle = bgColor
    ctx.fill()
    ctx.strokeStyle = laneColor(lane)
    ctx.lineWidth = metrics.mergeStroke
    ctx.stroke()
  } else {
    ctx.globalAlpha = dim ? 0.25 : 1
    ctx.beginPath()
    ctx.arc(dotX, rowMid, metrics.dotRadius, 0, Math.PI * 2)
    ctx.fillStyle = laneColor(lane)
    ctx.fill()
  }
}

export function drawMergeGlyph(
  ctx: CanvasRenderingContext2D,
  dotX: number,
  rowMid: number,
  glyph: 'collapsed' | 'expanded',
  color: string,
  metrics: GraphMetrics
): void {
  ctx.globalAlpha = 1
  ctx.strokeStyle = color
  ctx.lineWidth = metrics.mergeGlyphStroke
  ctx.beginPath()
  ctx.moveTo(dotX - metrics.mergeGlyphArm, rowMid)
  ctx.lineTo(dotX + metrics.mergeGlyphArm, rowMid)
  if (glyph === 'collapsed') {
    ctx.moveTo(dotX, rowMid - metrics.mergeGlyphArm)
    ctx.lineTo(dotX, rowMid + metrics.mergeGlyphArm)
  }
  ctx.stroke()
}

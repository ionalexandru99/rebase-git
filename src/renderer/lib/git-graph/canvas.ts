import { HISTORY_OVERSCAN } from '@/lib/virtual-config'
import type { LaneBoundary, RowLayout } from './layout'

export interface GraphMetrics {
  rootPx: number
  rowHeight: number
  columnWidth: number
  railPadding: number
  dotRadius: number
  mergeDotRadius: number
  mergeStroke: number
  mergeGlyphArm: number
  mergeGlyphStroke: number
}

export function readGraphMetrics(): GraphMetrics {
  let rootPx = 16
  if (typeof document !== 'undefined') {
    const measured = parseFloat(getComputedStyle(document.documentElement).fontSize)
    if (Number.isFinite(measured) && measured > 0) {
      rootPx = measured
    }
  }
  return {
    rootPx,
    rowHeight: Math.round(rootPx * 2.5),
    columnWidth: Math.round(rootPx),
    railPadding: Math.round(rootPx * 0.875),
    dotRadius: rootPx * 0.3125,
    mergeDotRadius: rootPx * 0.25,
    mergeStroke: Math.max(1, rootPx * 0.1),
    mergeGlyphArm: rootPx * 0.2,
    mergeGlyphStroke: Math.max(1, rootPx * 0.09)
  }
}

const DEFAULT_METRICS = readGraphMetrics()

export const ROW_H = DEFAULT_METRICS.rowHeight
export const COL_W = DEFAULT_METRICS.columnWidth
export const RAIL_PAD = DEFAULT_METRICS.railPadding
export const DOT_R = DEFAULT_METRICS.dotRadius
export const MERGE_DOT_R = DEFAULT_METRICS.mergeDotRadius
export const MERGE_STROKE = DEFAULT_METRICS.mergeStroke
export const MERGE_GLYPH_ARM = DEFAULT_METRICS.mergeGlyphArm
export const MERGE_GLYPH_STROKE = DEFAULT_METRICS.mergeGlyphStroke
export const OVERSCAN = HISTORY_OVERSCAN

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

export function laneX(lane: number, metrics = DEFAULT_METRICS): number {
  return metrics.railPadding + lane * metrics.columnWidth
}

export function computeGraphRailWidth(maxLanes: number, metrics = DEFAULT_METRICS): number {
  return Math.max(28, metrics.railPadding * 2 + Math.max(maxLanes - 1, 0) * metrics.columnWidth)
}

export function computeRowRailWidth(
  row: RowLayout,
  incoming: LaneBoundary,
  outgoing: LaneBoundary
): number {
  let maxLane = row.commitLane
  for (let lane = incoming.length - 1; lane > maxLane; lane--) {
    if (incoming[lane] !== null) {
      maxLane = lane
      break
    }
  }
  for (let lane = outgoing.length - 1; lane > maxLane; lane--) {
    if (outgoing[lane] !== null) {
      maxLane = lane
      break
    }
  }
  return computeGraphRailWidth(maxLane + 1)
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
  row: RowLayout,
  incoming: LaneBoundary,
  outgoing: LaneBoundary,
  yTop: number,
  isFirst: boolean,
  dim: boolean,
  metrics = DEFAULT_METRICS
): void {
  const rowMid = yTop + metrics.rowHeight / 2
  const rowBottom = yTop + metrics.rowHeight
  const dotX = laneX(row.commitLane, metrics)

  if (!isFirst) {
    for (let lane = 0; lane < incoming.length; lane++) {
      const hash = incoming[lane]
      if (hash === null) {
        continue
      }
      const startX = laneX(lane, metrics)
      if (hash === row.commit.hash && lane !== row.commitLane) {
        addEdge(
          batch,
          lane,
          dim,
          startX,
          yTop,
          dotX,
          rowMid,
          startX,
          rowMid - metrics.rowHeight / 4,
          dotX,
          rowMid - metrics.rowHeight / 4
        )
      } else {
        addEdge(batch, lane, dim, startX, yTop, hash === row.commit.hash ? dotX : startX, rowMid)
      }
    }
  }

  for (let lane = 0; lane < outgoing.length; lane++) {
    const hash = outgoing[lane]
    if (hash === null) {
      continue
    }
    const endX = laneX(lane, metrics)
    if (incoming[lane] === hash || dotX === endX) {
      addEdge(batch, lane, dim, incoming[lane] === hash ? endX : dotX, rowMid, endX, rowBottom)
    } else {
      addEdge(
        batch,
        lane,
        dim,
        dotX,
        rowMid,
        endX,
        rowBottom,
        dotX,
        rowMid + metrics.rowHeight / 4,
        endX,
        rowMid + metrics.rowHeight / 4
      )
    }
  }

  for (const parent of row.commit.parents) {
    const lane = outgoing.indexOf(parent)
    if (lane === -1 || lane === row.commitLane || incoming[lane] !== parent) {
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
      rowMid + metrics.rowHeight / 4,
      endX,
      rowMid + metrics.rowHeight / 4
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
  row: RowLayout,
  yTop: number,
  dim: boolean,
  bgColor: string,
  metrics = DEFAULT_METRICS
): void {
  const rowMid = yTop + metrics.rowHeight / 2
  const dotX = laneX(row.commitLane, metrics)
  if (row.commit.parents.length >= 2) {
    ctx.globalAlpha = dim ? 0.25 : 0.95
    ctx.beginPath()
    ctx.arc(dotX, rowMid, metrics.mergeDotRadius, 0, Math.PI * 2)
    ctx.fillStyle = bgColor
    ctx.fill()
    ctx.strokeStyle = laneColor(row.commitLane)
    ctx.lineWidth = metrics.mergeStroke
    ctx.stroke()
  } else {
    ctx.globalAlpha = dim ? 0.25 : 1
    ctx.beginPath()
    ctx.arc(dotX, rowMid, metrics.dotRadius, 0, Math.PI * 2)
    ctx.fillStyle = laneColor(row.commitLane)
    ctx.fill()
  }
}

export function drawMergeGlyph(
  ctx: CanvasRenderingContext2D,
  dotX: number,
  rowMid: number,
  glyph: 'collapsed' | 'expanded',
  color: string,
  metrics = DEFAULT_METRICS
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

export function drawGraphRow(
  ctx: CanvasRenderingContext2D,
  row: RowLayout,
  incoming: LaneBoundary,
  outgoing: LaneBoundary,
  yTop: number,
  isFirst: boolean,
  dim: boolean,
  bgColor: string
): void {
  const batch = createEdgeBatch()
  collectRowEdges(batch, row, incoming, outgoing, yTop, isFirst, dim)
  strokeEdgeBatch(ctx, batch)
  drawCommitDot(ctx, row, yTop, dim, bgColor)
}

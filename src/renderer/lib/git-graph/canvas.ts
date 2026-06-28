import type { RowLayout } from './layout'

function getRootFontPx(): number {
  if (typeof document === 'undefined') {
    return 16
  }
  const px = parseFloat(getComputedStyle(document.documentElement).fontSize)
  return Number.isFinite(px) && px > 0 ? px : 16
}
const ROOT_PX = getRootFontPx()

export const ROW_H = Math.round(ROOT_PX * 2.5)
export const COL_W = Math.round(ROOT_PX)
export const RAIL_PAD = Math.round(ROOT_PX * 0.875)
export const DOT_R = ROOT_PX * 0.3125
// Merge nodes are drawn as a ring (stroke, no fill) one notch larger than the solid commit dot, both
// derived from the root font size so the graph scales with zoom instead of using fixed pixels.
export const MERGE_DOT_R = ROOT_PX * 0.25
export const MERGE_STROKE = Math.max(1, ROOT_PX * 0.1)
export const MERGE_GLYPH_ARM = ROOT_PX * 0.2
export const MERGE_GLYPH_STROKE = Math.max(1, ROOT_PX * 0.09)

import { HISTORY_OVERSCAN } from '@/lib/virtual-config'

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

export function laneX(lane: number): number {
  return RAIL_PAD + lane * COL_W
}

export function computeGraphRailWidth(maxLanes: number): number {
  return Math.max(28, RAIL_PAD * 2 + Math.max(maxLanes - 1, 0) * COL_W)
}

export function computeRowRailWidth(row: RowLayout): number {
  let maxLane = row.commitLane
  for (let lane = row.incoming.length - 1; lane > maxLane; lane--) {
    if (row.incoming[lane] !== null) {
      maxLane = lane
      break
    }
  }
  for (let lane = row.outgoing.length - 1; lane > maxLane; lane--) {
    if (row.outgoing[lane] !== null) {
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
  control: readonly [number, number, number, number] | null
  endX: number
  endY: number
}

interface EdgeGroup {
  strokeStyle: string
  alpha: number
  segments: EdgeSegment[]
}

export type EdgeBatch = Map<string, EdgeGroup>

export function createEdgeBatch(): EdgeBatch {
  return new Map()
}

function lineSegment(startX: number, startY: number, endX: number, endY: number): EdgeSegment {
  return { startX, startY, control: null, endX, endY }
}

function bezierSegment(
  startX: number,
  startY: number,
  controlX1: number,
  controlY1: number,
  controlX2: number,
  controlY2: number,
  endX: number,
  endY: number
): EdgeSegment {
  return { startX, startY, control: [controlX1, controlY1, controlX2, controlY2], endX, endY }
}

function addEdge(batch: EdgeBatch, strokeStyle: string, alpha: number, segment: EdgeSegment): void {
  const key = `${alpha}|${strokeStyle}`
  let group = batch.get(key)
  if (!group) {
    group = { strokeStyle, alpha, segments: [] }
    batch.set(key, group)
  }
  group.segments.push(segment)
}

export function collectRowEdges(
  batch: EdgeBatch,
  row: RowLayout,
  yTop: number,
  isFirst: boolean,
  dim: boolean
): void {
  const rowMid = yTop + ROW_H / 2
  const rowBot = yTop + ROW_H
  const dotX = laneX(row.commitLane)
  const edgeAlpha = dim ? 0.2 : 0.85

  if (!isFirst) {
    for (let j = 0; j < row.incoming.length; j++) {
      const hash = row.incoming[j]
      if (hash === null) {
        continue
      }
      const color = laneColor(j)
      if (hash === row.commit.hash) {
        if (j === row.commitLane) {
          addEdge(batch, color, edgeAlpha, lineSegment(laneX(j), yTop, dotX, rowMid))
        } else {
          addEdge(
            batch,
            color,
            edgeAlpha,
            bezierSegment(
              laneX(j),
              yTop,
              laneX(j),
              rowMid - ROW_H / 4,
              dotX,
              rowMid - ROW_H / 4,
              dotX,
              rowMid
            )
          )
        }
      } else {
        addEdge(batch, color, edgeAlpha, lineSegment(laneX(j), yTop, laneX(j), rowMid))
      }
    }
  }

  for (let j = 0; j < row.outgoing.length; j++) {
    const hash = row.outgoing[j]
    if (hash === null) {
      continue
    }
    const color = laneColor(j)
    const passThrough = row.incoming[j] === hash
    if (passThrough) {
      addEdge(batch, color, edgeAlpha, lineSegment(laneX(j), rowMid, laneX(j), rowBot))
      continue
    }
    const endX = laneX(j)
    if (dotX === endX) {
      addEdge(batch, color, edgeAlpha, lineSegment(endX, rowMid, endX, rowBot))
    } else {
      addEdge(
        batch,
        color,
        edgeAlpha,
        bezierSegment(
          dotX,
          rowMid,
          dotX,
          rowMid + ROW_H / 4,
          endX,
          rowMid + ROW_H / 4,
          endX,
          rowBot
        )
      )
    }
  }

  for (const parent of row.commit.parents) {
    const j = row.outgoing.indexOf(parent)
    if (j === -1 || j === row.commitLane) {
      continue
    }
    if (row.incoming[j] !== parent) {
      continue
    }
    const endX = laneX(j)
    addEdge(
      batch,
      laneColor(j),
      edgeAlpha,
      bezierSegment(dotX, rowMid, dotX, rowMid + ROW_H / 4, endX, rowMid + ROW_H / 4, endX, rowBot)
    )
  }
}

export function strokeEdgeBatch(ctx: CanvasRenderingContext2D, batch: EdgeBatch): void {
  if (batch.size === 0) {
    return
  }
  ctx.lineWidth = 2
  for (const group of batch.values()) {
    ctx.globalAlpha = group.alpha
    ctx.strokeStyle = group.strokeStyle
    ctx.beginPath()
    for (const segment of group.segments) {
      ctx.moveTo(segment.startX, segment.startY)
      if (segment.control) {
        ctx.bezierCurveTo(
          segment.control[0],
          segment.control[1],
          segment.control[2],
          segment.control[3],
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
  bgColor: string
): void {
  const rowMid = yTop + ROW_H / 2
  const dotX = laneX(row.commitLane)
  const isMerge = row.commit.parents.length >= 2
  if (isMerge) {
    ctx.globalAlpha = dim ? 0.25 : 0.95
    ctx.beginPath()
    ctx.arc(dotX, rowMid, MERGE_DOT_R, 0, Math.PI * 2)
    ctx.fillStyle = bgColor
    ctx.fill()
    ctx.strokeStyle = laneColor(row.commitLane)
    ctx.lineWidth = MERGE_STROKE
    ctx.stroke()
  } else {
    ctx.globalAlpha = dim ? 0.25 : 1
    ctx.beginPath()
    ctx.arc(dotX, rowMid, DOT_R, 0, Math.PI * 2)
    ctx.fillStyle = laneColor(row.commitLane)
    ctx.fill()
  }
}

export function drawMergeGlyph(
  ctx: CanvasRenderingContext2D,
  dotX: number,
  rowMid: number,
  glyph: 'collapsed' | 'expanded',
  color: string
): void {
  ctx.globalAlpha = 1
  ctx.strokeStyle = color
  ctx.lineWidth = MERGE_GLYPH_STROKE
  ctx.beginPath()
  ctx.moveTo(dotX - MERGE_GLYPH_ARM, rowMid)
  ctx.lineTo(dotX + MERGE_GLYPH_ARM, rowMid)
  if (glyph === 'collapsed') {
    ctx.moveTo(dotX, rowMid - MERGE_GLYPH_ARM)
    ctx.lineTo(dotX, rowMid + MERGE_GLYPH_ARM)
  }
  ctx.stroke()
}

export function drawGraphRow(
  ctx: CanvasRenderingContext2D,
  row: RowLayout,
  yTop: number,
  isFirst: boolean,
  dim: boolean,
  bgColor: string
): void {
  const batch = createEdgeBatch()
  collectRowEdges(batch, row, yTop, isFirst, dim)
  strokeEdgeBatch(ctx, batch)
  drawCommitDot(ctx, row, yTop, dim, bgColor)
}

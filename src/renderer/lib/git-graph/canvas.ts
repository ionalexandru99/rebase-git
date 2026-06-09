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

export function drawGraphRow(
  ctx: CanvasRenderingContext2D,
  row: RowLayout,
  yTop: number,
  isFirst: boolean,
  dim: boolean,
  bgColor: string,
  mergeColor: string
): void {
  const rowMid = yTop + ROW_H / 2
  const rowBot = yTop + ROW_H
  const dotX = laneX(row.commitLane)
  const edgeAlpha = dim ? 0.2 : 0.85

  ctx.lineWidth = 2
  ctx.globalAlpha = edgeAlpha

  if (!isFirst) {
    for (let j = 0; j < row.incoming.length; j++) {
      const hash = row.incoming[j]
      if (hash === null) {
        continue
      }
      ctx.strokeStyle = laneColor(j)
      if (hash === row.commit.hash) {
        if (j === row.commitLane) {
          ctx.beginPath()
          ctx.moveTo(laneX(j), yTop)
          ctx.lineTo(dotX, rowMid)
          ctx.stroke()
        } else {
          ctx.beginPath()
          ctx.moveTo(laneX(j), yTop)
          ctx.bezierCurveTo(laneX(j), rowMid - ROW_H / 4, dotX, rowMid - ROW_H / 4, dotX, rowMid)
          ctx.stroke()
        }
      } else {
        ctx.beginPath()
        ctx.moveTo(laneX(j), yTop)
        ctx.lineTo(laneX(j), rowMid)
        ctx.stroke()
      }
    }
  }

  for (let j = 0; j < row.outgoing.length; j++) {
    const hash = row.outgoing[j]
    if (hash === null) {
      continue
    }
    ctx.strokeStyle = laneColor(j)
    const passThrough = row.incoming[j] === hash
    if (passThrough) {
      ctx.beginPath()
      ctx.moveTo(laneX(j), rowMid)
      ctx.lineTo(laneX(j), rowBot)
      ctx.stroke()
      continue
    }
    const endX = laneX(j)
    if (dotX === endX) {
      ctx.beginPath()
      ctx.moveTo(endX, rowMid)
      ctx.lineTo(endX, rowBot)
      ctx.stroke()
    } else {
      ctx.beginPath()
      ctx.moveTo(dotX, rowMid)
      ctx.bezierCurveTo(dotX, rowMid + ROW_H / 4, endX, rowMid + ROW_H / 4, endX, rowBot)
      ctx.stroke()
    }
  }

  const parentSet = new Set(row.commit.parents)
  for (const parent of row.commit.parents) {
    const j = row.outgoing.indexOf(parent)
    if (j === -1 || j === row.commitLane) {
      continue
    }
    if (row.incoming[j] !== parent) {
      continue
    }
    if (!parentSet.has(row.outgoing[j] ?? '')) {
      continue
    }
    const endX = laneX(j)
    ctx.strokeStyle = laneColor(j)
    ctx.beginPath()
    ctx.moveTo(dotX, rowMid)
    ctx.bezierCurveTo(dotX, rowMid + ROW_H / 4, endX, rowMid + ROW_H / 4, endX, rowBot)
    ctx.stroke()
  }

  const isMerge = row.commit.parents.length >= 2
  if (isMerge) {
    ctx.globalAlpha = dim ? 0.25 : 0.95
    ctx.beginPath()
    ctx.arc(dotX, rowMid, 4, 0, Math.PI * 2)
    ctx.fillStyle = bgColor
    ctx.fill()
    ctx.strokeStyle = mergeColor
    ctx.lineWidth = 1.6
    ctx.stroke()
  } else {
    ctx.globalAlpha = dim ? 0.25 : 1
    ctx.beginPath()
    ctx.arc(dotX, rowMid, DOT_R, 0, Math.PI * 2)
    ctx.fillStyle = laneColor(row.commitLane)
    ctx.fill()
  }
}

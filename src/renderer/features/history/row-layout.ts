import { computeGraphRailWidth } from './graph/canvas'
import type { GraphMetrics } from './graph/metrics'
import { type HistoryListMode, modeShowsAuthorName } from './list-modes'

export const HISTORY_RAIL_MAX_LANES = 8

export function historyRailWidth(maxLanes: number, metrics: GraphMetrics): number {
  const lanes = Number.isFinite(maxLanes)
    ? Math.min(Math.max(Math.floor(maxLanes), 1), HISTORY_RAIL_MAX_LANES)
    : 1
  return computeGraphRailWidth(lanes, metrics)
}

interface ReanchorOptions {
  scrollTop: number
  previousRowHeight: number
  nextRowHeight: number
  paddingStart: number
}

export function reanchorScrollTop(options: ReanchorOptions): number {
  if (
    options.previousRowHeight === options.nextRowHeight ||
    options.scrollTop <= options.paddingStart
  ) {
    return options.scrollTop
  }
  const rowsAbove = Math.ceil(
    (options.scrollTop - options.paddingStart) / options.previousRowHeight
  )
  return options.paddingStart + rowsAbove * options.nextRowHeight
}

const AUTHOR_COLUMN = '10rem'
const AVATAR_COLUMN = '1rem'
const SHA_COLUMN = '4.5rem'
const DATE_COLUMN = '5rem'
const CHURN_COLUMN = '4.5rem'

export function singleLineGridTemplate(mode: HistoryListMode): string {
  const authorColumn = modeShowsAuthorName(mode) ? AUTHOR_COLUMN : AVATAR_COLUMN
  return `minmax(0,1fr) ${authorColumn} ${SHA_COLUMN} ${DATE_COLUMN} ${CHURN_COLUMN}`
}

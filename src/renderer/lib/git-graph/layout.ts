import type { GitLogEntry } from '@/types'
import { matchesCommitPrefix } from './commit-sequence'

export type LaneBoundary = readonly (string | null)[]

export interface RowLayout {
  commit: GitLogEntry
  commitLane: number
}

export interface LayoutRowChunk {
  startIndex: number
  rows: RowLayout[]
}

export interface LayoutBoundaryChunk {
  startIndex: number
  boundaries: LaneBoundary[]
}

export interface LayoutResult {
  rowChunks: LayoutRowChunk[]
  boundaryChunks: LayoutBoundaryChunk[]
  rowCount: number
  boundaryCount: number
  maxLanes: number
  lanesAfter: LaneBoundary
  commits: GitLogEntry[]
  laidOutThroughIndex: number
}

export interface LayoutCommitsOptions {
  maxCommits?: number
  startIndex?: number
  endIndex?: number
  isHiddenParent?: (hash: string) => boolean
}

function laneIndexOf(lanes: LaneBoundary, hash: string): number {
  for (let index = 0; index < lanes.length; index++) {
    if (lanes[index] === hash) {
      return index
    }
  }
  return -1
}

function firstNullLane(lanes: LaneBoundary): number {
  for (let index = 0; index < lanes.length; index++) {
    if (lanes[index] === null) {
      return index
    }
  }
  return -1
}

function trimTrailingNullLanes(lanes: (string | null)[]): void {
  while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
    lanes.pop()
  }
}

function layoutRow(
  commit: GitLogEntry,
  incoming: LaneBoundary,
  isHiddenParent?: (hash: string) => boolean
): { row: RowLayout; outgoing: LaneBoundary; maxLanes: number } {
  const lanes = [...incoming]
  let commitLane = laneIndexOf(lanes, commit.hash)
  if (commitLane === -1) {
    commitLane = firstNullLane(lanes)
    if (commitLane === -1) {
      commitLane = lanes.length
      lanes.push(null)
    }
  }

  for (let laneIndex = 0; laneIndex < lanes.length; laneIndex++) {
    if (lanes[laneIndex] === commit.hash) {
      lanes[laneIndex] = null
    }
  }

  for (let parentIndex = 0; parentIndex < commit.parents.length; parentIndex++) {
    const parent = commit.parents[parentIndex]
    if (isHiddenParent?.(parent) || laneIndexOf(lanes, parent) !== -1) {
      continue
    }
    if (parentIndex === 0 && (lanes[commitLane] === null || lanes[commitLane] === undefined)) {
      lanes[commitLane] = parent
      continue
    }
    const slot = firstNullLane(lanes)
    if (slot !== -1) {
      lanes[slot] = parent
    } else {
      lanes.push(parent)
    }
  }

  trimTrailingNullLanes(lanes)

  return {
    row: { commit, commitLane },
    outgoing: lanes,
    maxLanes: Math.max(incoming.length, lanes.length, commitLane + 1)
  }
}

function chunkAt<T extends { startIndex: number }>(
  chunks: readonly T[],
  index: number
): T | undefined {
  let low = 0
  let high = chunks.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    const chunk = chunks[middle]
    const nextStart = chunks[middle + 1]?.startIndex ?? Number.POSITIVE_INFINITY
    if (index < chunk.startIndex) {
      high = middle - 1
    } else if (index >= nextStart) {
      low = middle + 1
    } else {
      return chunk
    }
  }
  return undefined
}

export function getLayoutRow(layout: LayoutResult, index: number): RowLayout | undefined {
  if (index < 0 || index >= layout.rowCount) {
    return undefined
  }
  const chunk = chunkAt(layout.rowChunks, index)
  return chunk?.rows[index - chunk.startIndex]
}

export function getLayoutBoundary(layout: LayoutResult, index: number): LaneBoundary {
  if (index < 0 || index >= layout.boundaryCount) {
    return []
  }
  const chunk = chunkAt(layout.boundaryChunks, index)
  return chunk?.boundaries[index - chunk.startIndex] ?? []
}

export function layoutRows(layout: LayoutResult): RowLayout[] {
  const rows = new Array<RowLayout>(layout.rowCount)
  for (const chunk of layout.rowChunks) {
    for (let offset = 0; offset < chunk.rows.length; offset++) {
      rows[chunk.startIndex + offset] = chunk.rows[offset]
    }
  }
  return rows
}

export function layoutCommits(
  commits: GitLogEntry[],
  prev?: LayoutResult,
  options?: LayoutCommitsOptions
): LayoutResult {
  const maxCommits = Math.min(options?.maxCommits ?? commits.length, commits.length)
  const cappedCommits = commits.slice(0, maxCommits)
  const endIndex = Math.min(options?.endIndex ?? cappedCommits.length, cappedCommits.length)
  let startIndex = options?.startIndex ?? 0
  let rowChunks: LayoutRowChunk[] = []
  let boundaryChunks: LayoutBoundaryChunk[] = []
  let maxLanes = 0

  const extendsPrefix =
    prev !== undefined &&
    startIndex === 0 &&
    prev.rowCount > 0 &&
    matchesCommitPrefix(prev.commits, cappedCommits, prev.rowCount)
  const extendsWindow =
    prev !== undefined && startIndex > 0 && startIndex === prev.laidOutThroughIndex

  if (extendsPrefix || extendsWindow) {
    startIndex = extendsPrefix ? prev.rowCount : startIndex
    rowChunks = prev.rowChunks
    boundaryChunks = prev.boundaryChunks
    maxLanes = prev.maxLanes
  } else {
    startIndex = 0
  }

  let incoming =
    startIndex === 0 || !prev ? ([] as LaneBoundary) : getLayoutBoundary(prev, startIndex)
  const nextRows: RowLayout[] = []
  const nextBoundaries: LaneBoundary[] = startIndex === 0 ? [incoming] : []

  for (let index = startIndex; index < endIndex; index++) {
    const {
      row,
      outgoing,
      maxLanes: rowMaxLanes
    } = layoutRow(cappedCommits[index], incoming, options?.isHiddenParent)
    maxLanes = Math.max(maxLanes, rowMaxLanes)
    nextRows.push(row)
    nextBoundaries.push(outgoing)
    incoming = outgoing
  }

  if (nextRows.length > 0) {
    rowChunks = [...rowChunks, { startIndex, rows: nextRows }]
  }
  if (nextBoundaries.length > 0) {
    boundaryChunks = [
      ...boundaryChunks,
      { startIndex: startIndex === 0 ? 0 : startIndex + 1, boundaries: nextBoundaries }
    ]
  }

  return {
    rowChunks,
    boundaryChunks,
    rowCount: endIndex,
    boundaryCount: endIndex + 1,
    maxLanes,
    lanesAfter: incoming,
    commits: cappedCommits,
    laidOutThroughIndex: endIndex
  }
}

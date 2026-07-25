import type { GitLogEntry } from '@/types'

// The lane algorithm only ever compares parents for identity, so the graph crosses into the layout
// (and the worker) as plain integers: a parent is the row that carries it, or a negative id minted
// for a parent that has not streamed in yet. No strings, no allocation per row, transferable as-is.
export interface GraphTopology {
  // Rows [firstRow, commitCount) are described here; a slice starting past 0 is what gets sent to a
  // worker that already holds the rows before it.
  firstRow: number
  commitCount: number
  parentOffsets: Int32Array
  parentIds: Int32Array
}

export const EMPTY_LANE = -1

const FIRST_PENDING_ID = -2

export interface GraphTopologyOptions {
  rowOf?: (hash: string) => number | undefined
  isHiddenParent?: (hash: string) => boolean
}

export function buildGraphTopology(
  commits: readonly GitLogEntry[],
  options: GraphTopologyOptions = {}
): GraphTopology {
  const rowOf = options.rowOf ?? defaultRowOf(commits)
  const isHiddenParent = options.isHiddenParent
  const parentOffsets = new Int32Array(commits.length + 1)
  const parentIds = new Int32Array(countParents(commits))
  const pendingIds = new Map<string, number>()
  let cursor = 0

  for (let row = 0; row < commits.length; row++) {
    parentOffsets[row] = cursor
    for (const parent of commits[row].parents) {
      const parentRow = rowOf(parent)
      if (parentRow !== undefined) {
        parentIds[cursor++] = parentRow
        continue
      }
      if (isHiddenParent?.(parent)) {
        continue
      }
      let pendingId = pendingIds.get(parent)
      if (pendingId === undefined) {
        pendingId = FIRST_PENDING_ID - pendingIds.size
        pendingIds.set(parent, pendingId)
      }
      parentIds[cursor++] = pendingId
    }
  }
  parentOffsets[commits.length] = cursor

  return {
    firstRow: 0,
    commitCount: commits.length,
    parentOffsets,
    parentIds: parentIds.subarray(0, cursor)
  }
}

export function parentIdsOf(topology: GraphTopology, row: number): Int32Array {
  const slot = row - topology.firstRow
  return topology.parentIds.subarray(topology.parentOffsets[slot], topology.parentOffsets[slot + 1])
}

// Detached copies of rows [firstRow, commitCount) — copies rather than views so the buffers can be
// transferred to the worker without detaching the topology the renderer keeps for the next diff.
export function sliceTopology(topology: GraphTopology, firstRow: number): GraphTopology {
  const from = Math.max(firstRow, topology.firstRow) - topology.firstRow
  const parentStart = topology.parentOffsets[from]
  const parentOffsets = topology.parentOffsets.slice(from)
  for (let slot = 0; slot < parentOffsets.length; slot++) {
    parentOffsets[slot] -= parentStart
  }
  return {
    firstRow: topology.firstRow + from,
    commitCount: topology.commitCount,
    parentOffsets,
    parentIds: topology.parentIds.slice(parentStart)
  }
}

// How many leading rows of `next` are laid out exactly as they were in `previous`. Appending to the
// log leaves earlier rows untouched, so the layout can resume from here instead of restarting.
export function sharedTopologyRows(previous: GraphTopology, next: GraphTopology): number {
  const limit = Math.min(previous.commitCount, next.commitCount)
  for (let row = 0; row < limit; row++) {
    const previousStart = previous.parentOffsets[row]
    const nextStart = next.parentOffsets[row]
    const parentCount = previous.parentOffsets[row + 1] - previousStart
    if (parentCount !== next.parentOffsets[row + 1] - nextStart) {
      return row
    }
    for (let offset = 0; offset < parentCount; offset++) {
      if (previous.parentIds[previousStart + offset] !== next.parentIds[nextStart + offset]) {
        return row
      }
    }
  }
  return limit
}

function countParents(commits: readonly GitLogEntry[]): number {
  let total = 0
  for (const commit of commits) {
    total += commit.parents.length
  }
  return total
}

function defaultRowOf(commits: readonly GitLogEntry[]): (hash: string) => number | undefined {
  const rows = new Map<string, number>()
  for (let row = 0; row < commits.length; row++) {
    rows.set(commits[row].hash, row)
  }
  return (hash) => rows.get(hash)
}

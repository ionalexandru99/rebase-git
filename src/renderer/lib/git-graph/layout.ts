import type { GitLogEntry } from '@/types'

export interface RowLayout {
  commit: GitLogEntry
  commitLane: number
  incoming: (string | null)[]
  outgoing: (string | null)[]
}

export interface LayoutResult {
  rows: RowLayout[]
  maxLanes: number
  lanesAfter: (string | null)[]
  commits: GitLogEntry[]
  laidOutThroughIndex: number
}

export interface LayoutCommitsOptions {
  maxCommits?: number
  startIndex?: number
  endIndex?: number
}

function laneIndexOf(lanes: (string | null)[], hash: string): number {
  for (let index = 0; index < lanes.length; index++) {
    if (lanes[index] === hash) {
      return index
    }
  }
  return -1
}

function firstNullLane(lanes: (string | null)[]): number {
  for (let index = 0; index < lanes.length; index++) {
    if (lanes[index] === null) {
      return index
    }
  }
  return -1
}

function parentLaneIndex(lanes: (string | null)[], parent: string): number {
  return laneIndexOf(lanes, parent)
}

function trimTrailingNullLanes(lanes: (string | null)[]): void {
  while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
    lanes.pop()
  }
}

function layoutRow(
  commit: GitLogEntry,
  lanes: (string | null)[]
): { row: Omit<RowLayout, 'commit'>; maxLanes: number } {
  const incoming = [...lanes]

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

  for (let parentIdx = 0; parentIdx < commit.parents.length; parentIdx++) {
    const parent = commit.parents[parentIdx]
    if (parentLaneIndex(lanes, parent) !== -1) {
      continue
    }
    if (parentIdx === 0 && (lanes[commitLane] === null || lanes[commitLane] === undefined)) {
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

  const outgoing = [...lanes]
  const maxLanes = Math.max(incoming.length, outgoing.length, commitLane + 1)

  return {
    row: { commitLane, incoming, outgoing },
    maxLanes
  }
}

export function layoutCommits(
  commits: GitLogEntry[],
  prev?: LayoutResult,
  options?: LayoutCommitsOptions
): LayoutResult {
  const maxCommits = options?.maxCommits ?? commits.length
  const cappedCommits = commits.slice(0, maxCommits)
  const endIndex = Math.min(options?.endIndex ?? cappedCommits.length, cappedCommits.length)
  let startIdx = options?.startIndex ?? 0

  let lanes: (string | null)[] = []
  let rows: RowLayout[] = []
  let maxLanes = 0

  if (
    prev &&
    startIdx === 0 &&
    prev.rows.length > 0 &&
    cappedCommits.length >= prev.rows.length &&
    cappedCommits[0]?.hash === prev.rows[0]?.commit.hash &&
    cappedCommits[prev.rows.length - 1]?.hash === prev.rows[prev.rows.length - 1]?.commit.hash
  ) {
    startIdx = prev.rows.length
    lanes = prev.lanesAfter.slice()
    rows = prev.rows
    maxLanes = prev.maxLanes
  } else if (prev && startIdx > 0 && startIdx === prev.laidOutThroughIndex) {
    lanes = prev.lanesAfter.slice()
    rows = prev.rows.slice()
    maxLanes = prev.maxLanes
  } else {
    startIdx = 0
    rows = []
  }

  for (let idx = startIdx; idx < endIndex; idx++) {
    const commit = cappedCommits[idx]
    const { row, maxLanes: rowMaxLanes } = layoutRow(commit, lanes)
    maxLanes = Math.max(maxLanes, rowMaxLanes)
    rows.push({ commit, ...row })
  }

  return {
    rows,
    maxLanes,
    lanesAfter: lanes,
    commits: cappedCommits,
    laidOutThroughIndex: endIndex
  }
}

export function attachCommitsToLayoutRows(
  commits: GitLogEntry[],
  wireRows: ReadonlyArray<{
    commitLane: number
    incoming: (string | null)[]
    outgoing: (string | null)[]
  }>
): RowLayout[] {
  const rows: RowLayout[] = []
  for (let index = 0; index < wireRows.length; index++) {
    const commit = commits[index]
    const wireRow = wireRows[index]
    if (!commit || !wireRow) {
      continue
    }
    rows.push({
      commit,
      commitLane: wireRow.commitLane,
      incoming: [...wireRow.incoming],
      outgoing: [...wireRow.outgoing]
    })
  }
  return rows
}

export function layoutResultFromSnapshot(
  commits: GitLogEntry[],
  snapshot: {
    rows: ReadonlyArray<{
      commitLane: number
      incoming: (string | null)[]
      outgoing: (string | null)[]
    }>
    maxLanes: number
    lanesAfter: (string | null)[]
    laidOutThroughIndex: number
  }
): LayoutResult {
  const slice = commits.slice(0, snapshot.laidOutThroughIndex)
  return {
    rows: attachCommitsToLayoutRows(slice, snapshot.rows),
    maxLanes: snapshot.maxLanes,
    lanesAfter: [...snapshot.lanesAfter],
    commits: slice,
    laidOutThroughIndex: snapshot.laidOutThroughIndex
  }
}

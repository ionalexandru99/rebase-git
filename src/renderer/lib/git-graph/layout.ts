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
}

export function layoutCommits(commits: GitLogEntry[], prev?: LayoutResult): LayoutResult {
  let startIdx = 0
  let lanes: (string | null)[] = []
  let rows: RowLayout[] = []
  let maxLanes = 0

  if (
    prev &&
    prev.commits.length > 0 &&
    commits.length >= prev.commits.length &&
    commits[0]?.hash === prev.commits[0]?.hash &&
    commits[prev.commits.length - 1]?.hash === prev.commits[prev.commits.length - 1]?.hash
  ) {
    startIdx = prev.commits.length
    lanes = prev.lanesAfter.slice()
    rows = prev.rows.slice()
    maxLanes = prev.maxLanes
  }

  for (let idx = startIdx; idx < commits.length; idx++) {
    const commit = commits[idx]
    const incoming = [...lanes]

    let commitLane = lanes.indexOf(commit.hash)
    if (commitLane === -1) {
      commitLane = lanes.indexOf(null)
      if (commitLane === -1) {
        commitLane = lanes.length
        lanes.push(null)
      }
    }

    lanes = lanes.map((lane) => (lane === commit.hash ? null : lane))

    for (let parentIdx = 0; parentIdx < commit.parents.length; parentIdx++) {
      const parent = commit.parents[parentIdx]
      if (lanes.includes(parent)) continue
      if (parentIdx === 0 && (lanes[commitLane] === null || lanes[commitLane] === undefined)) {
        lanes[commitLane] = parent
        continue
      }
      const slot = lanes.indexOf(null)
      if (slot !== -1) lanes[slot] = parent
      else lanes.push(parent)
    }

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop()

    const outgoing = [...lanes]
    maxLanes = Math.max(maxLanes, incoming.length, outgoing.length, commitLane + 1)

    rows.push({ commit, commitLane, incoming, outgoing })
  }

  return { rows, maxLanes, lanesAfter: lanes, commits }
}

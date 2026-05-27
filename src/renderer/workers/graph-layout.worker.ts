import type {
  ExtendLayoutRequest,
  LayoutRequest,
  LayoutResultMessage,
  LayoutWorkerRequest
} from '@shared/graph-layout-protocol'
import { layoutCommits, layoutResultFromSnapshot } from '../lib/git-graph/layout'
import type { GitLogEntry } from '../types'

function wireRowsFromResult(result: ReturnType<typeof layoutCommits>): LayoutResultMessage['rows'] {
  return result.rows.map((row) => ({
    commitLane: row.commitLane,
    incoming: row.incoming,
    outgoing: row.outgoing
  }))
}

function commitsFromWire(wireCommits: LayoutRequest['commits']): GitLogEntry[] {
  return wireCommits.map((commit) => ({
    hash: commit.hash,
    parents: commit.parents,
    message: '',
    author_name: '',
    date: '',
    refs: ''
  }))
}

function prevFromSnapshot(
  request: LayoutRequest | ExtendLayoutRequest,
  commits: GitLogEntry[]
): ReturnType<typeof layoutCommits> | undefined {
  if (!request.prev) {
    return undefined
  }
  return layoutResultFromSnapshot(commits, request.prev)
}

function handleLayout(request: LayoutRequest): LayoutResultMessage {
  const commits = commitsFromWire(request.commits)
  const windowEnd = Math.min(request.windowEnd, request.maxCommits, commits.length)
  const prev = prevFromSnapshot(request, commits)
  const result = layoutCommits(commits, prev, {
    maxCommits: request.maxCommits,
    endIndex: windowEnd
  })

  return {
    type: 'layout-result',
    generation: request.generation,
    rows: wireRowsFromResult(result),
    maxLanes: result.maxLanes,
    lanesAfter: result.lanesAfter,
    fromIndex: 0,
    toIndex: result.laidOutThroughIndex
  }
}

function handleExtend(request: ExtendLayoutRequest): LayoutResultMessage {
  const commits = commitsFromWire(request.commits)
  const targetIndex = Math.min(request.targetIndex, request.maxCommits, commits.length)
  const prev = prevFromSnapshot(request, commits)
  if (!prev) {
    return handleLayout({
      type: 'layout',
      generation: request.generation,
      commits: request.commits,
      maxCommits: request.maxCommits,
      windowEnd: targetIndex
    })
  }

  const fromIndex = prev.laidOutThroughIndex
  const result = layoutCommits(commits, prev, {
    maxCommits: request.maxCommits,
    startIndex: fromIndex,
    endIndex: targetIndex
  })

  return {
    type: 'layout-result',
    generation: request.generation,
    rows: wireRowsFromResult(result),
    maxLanes: result.maxLanes,
    lanesAfter: result.lanesAfter,
    fromIndex,
    toIndex: result.laidOutThroughIndex
  }
}

self.onmessage = (event: MessageEvent<LayoutWorkerRequest>) => {
  const request = event.data
  if (request.type === 'cancel') {
    return
  }

  const message = request.type === 'extend' ? handleExtend(request) : handleLayout(request)
  self.postMessage(message)
}

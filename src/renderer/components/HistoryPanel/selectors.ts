import { fuzzyMatchSet } from '@/lib/fuzzy'
import { parseRefs } from '@/lib/git-graph/refs'
import type { RefKind } from '@/lib/ref-tree'
import type { GitLogEntry } from '@/types'

export interface FilterRef {
  kind: RefKind
  fullPath: string
}

export function refFilterKey(kind: RefKind, fullPath: string): string {
  return `${kind}:${fullPath}`
}

export function parseFilterRefKey(key: string): FilterRef | null {
  const colon = key.indexOf(':')
  if (colon === -1) {
    return null
  }
  const kind = key.slice(0, colon) as RefKind
  if (kind !== 'local' && kind !== 'remote' && kind !== 'tag') {
    return null
  }
  const fullPath = key.slice(colon + 1)
  if (!fullPath) {
    return null
  }
  return { kind, fullPath }
}

export interface CommitIndex {
  byHash: Map<string, GitLogEntry>
  positionByHash: Map<string, number>
}

// Keyed by the commits array so each open repo keeps its own index instead of thrashing a single
// global slot; entries are released automatically when a repo's log array is dropped.
const commitIndexCache = new WeakMap<GitLogEntry[], CommitIndex>()

export function getCommitIndex(commits: GitLogEntry[]): CommitIndex {
  const cached = commitIndexCache.get(commits)
  if (cached) {
    return cached
  }
  const byHash = new Map<string, GitLogEntry>()
  const positionByHash = new Map<string, number>()
  for (let position = 0; position < commits.length; position++) {
    const commit = commits[position]
    byHash.set(commit.hash, commit)
    positionByHash.set(commit.hash, position)
  }
  const index = { byHash, positionByHash }
  commitIndexCache.set(commits, index)
  return index
}

export interface RefTipIndex {
  tipByRefKey: Map<string, string>
  headTip: string | undefined
}

const refTipIndexCache = new WeakMap<
  GitLogEntry[],
  { remoteNames: ReadonlySet<string> | undefined; index: RefTipIndex }
>()

function hasHeadMarker(refs: string): boolean {
  return refs.split(',').some((part) => {
    const trimmed = part.trim()
    return trimmed === 'HEAD' || trimmed.startsWith('HEAD -> ')
  })
}

export function getRefTipIndex(commits: GitLogEntry[], remoteNames?: Set<string>): RefTipIndex {
  const cached = refTipIndexCache.get(commits)
  if (cached && cached.remoteNames === remoteNames) {
    return cached.index
  }
  const tipByRefKey = new Map<string, string>()
  let headTip: string | undefined
  for (const commit of commits) {
    if (!commit.refs) {
      continue
    }
    if (headTip === undefined && hasHeadMarker(commit.refs)) {
      headTip = commit.hash
    }
    for (const ref of parseRefs(commit.refs, remoteNames)) {
      if (ref.kind !== 'branch' && ref.kind !== 'remote') {
        continue
      }
      const key = refFilterKey(ref.kind === 'branch' ? 'local' : 'remote', ref.label)
      if (!tipByRefKey.has(key)) {
        tipByRefKey.set(key, commit.hash)
      }
    }
  }
  const index = { tipByRefKey, headTip }
  refTipIndexCache.set(commits, { remoteNames, index })
  return index
}

function walkAncestors(
  byHash: Map<string, GitLogEntry>,
  startHash: string,
  visited: Set<string>
): void {
  const stack = [startHash]
  while (stack.length > 0) {
    const hash = stack.pop() as string
    if (visited.has(hash)) {
      continue
    }
    visited.add(hash)
    const commit = byHash.get(hash)
    if (!commit) {
      continue
    }
    for (const parent of commit.parents) {
      if (!visited.has(parent)) {
        stack.push(parent)
      }
    }
  }
}

export function findRefTip(
  commits: GitLogEntry[],
  refKind: RefKind,
  fullPath: string,
  remoteNames: Set<string>
): string | undefined {
  if (refKind === 'tag') {
    return undefined
  }
  return getRefTipIndex(commits, remoteNames).tipByRefKey.get(refFilterKey(refKind, fullPath))
}

export function resolveTrackingRemoteBranches(
  localBranch: string,
  remoteBranches: readonly string[],
  remoteNames?: ReadonlySet<string>
): string[] {
  const remoteSet = new Set(remoteBranches)
  const tracking: string[] = []
  const add = (fullPath: string) => {
    if (remoteSet.has(fullPath) && !tracking.includes(fullPath)) {
      tracking.push(fullPath)
    }
  }

  add(`origin/${localBranch}`)
  if (remoteNames) {
    for (const remote of remoteNames) {
      add(`${remote}/${localBranch}`)
    }
  }
  for (const fullPath of remoteBranches) {
    const slash = fullPath.indexOf('/')
    if (slash === -1) {
      continue
    }
    if (fullPath.slice(slash + 1) === localBranch) {
      add(fullPath)
    }
  }
  return tracking
}

export function expandFilterRefs(selectedRefs: ReadonlySet<string>): FilterRef[] {
  const expanded: FilterRef[] = []
  const seen = new Set<string>()

  for (const key of selectedRefs) {
    const parsed = parseFilterRefKey(key)
    if (!parsed || parsed.kind === 'tag') {
      continue
    }
    const ownKey = refFilterKey(parsed.kind, parsed.fullPath)
    if (!seen.has(ownKey)) {
      seen.add(ownKey)
      expanded.push(parsed)
    }
  }
  return expanded
}

export function countVisibleBranchRefs(
  selectedRefs: ReadonlySet<string>,
  remoteBranches: readonly string[] = [],
  remoteNames?: ReadonlySet<string>
): number {
  const refs = expandFilterRefs(selectedRefs)
  const selectedLocalBranches = new Set(
    refs.filter((ref) => ref.kind === 'local').map((ref) => ref.fullPath)
  )
  const trackingRemoteKeys = new Set<string>()
  for (const localBranch of selectedLocalBranches) {
    for (const trackingPath of resolveTrackingRemoteBranches(
      localBranch,
      remoteBranches,
      remoteNames
    )) {
      trackingRemoteKeys.add(refFilterKey('remote', trackingPath))
    }
  }

  let count = 0
  for (const ref of refs) {
    if (ref.kind === 'remote' && trackingRemoteKeys.has(refFilterKey('remote', ref.fullPath))) {
      continue
    }
    count += 1
  }
  return count
}

// Relies on commits being topo-ordered (children before parents), which the log stream
// guarantees: walking tips most-descendant-first means any tip already visited when its
// turn comes is an ancestor of an earlier tip. One shared visited set bounds the total
// walk at O(commits) regardless of tip count.
export function pruneAncestorTips(commits: GitLogEntry[], tipHashes: string[]): string[] {
  const { byHash, positionByHash } = getCommitIndex(commits)
  const ordered = [...tipHashes].sort(
    (left, right) => (positionByHash.get(left) ?? 0) - (positionByHash.get(right) ?? 0)
  )
  const visited = new Set<string>()
  const kept = new Set<string>()
  for (const tip of ordered) {
    if (visited.has(tip)) {
      continue
    }
    kept.add(tip)
    walkAncestors(byHash, tip, visited)
  }
  return tipHashes.filter((tip) => kept.has(tip))
}

function collectTimelineTips(
  commits: GitLogEntry[],
  selectedRefs: ReadonlySet<string>,
  remoteBranches: readonly string[],
  remoteNames: Set<string>
): string[] {
  const { tipByRefKey } = getRefTipIndex(commits, remoteNames)
  const tips: string[] = []
  const seen = new Set<string>()

  const addTip = (hash: string | undefined) => {
    if (!hash || seen.has(hash)) {
      return
    }
    seen.add(hash)
    tips.push(hash)
  }

  for (const key of selectedRefs) {
    const parsed = parseFilterRefKey(key)
    if (!parsed || parsed.kind === 'tag') {
      continue
    }
    addTip(tipByRefKey.get(refFilterKey(parsed.kind, parsed.fullPath)))
  }

  for (const key of selectedRefs) {
    const parsed = parseFilterRefKey(key)
    if (!parsed || parsed.kind !== 'local') {
      continue
    }
    const localTip = tipByRefKey.get(refFilterKey('local', parsed.fullPath))
    if (!localTip) {
      continue
    }
    for (const trackingPath of resolveTrackingRemoteBranches(
      parsed.fullPath,
      remoteBranches,
      remoteNames
    )) {
      const remoteKey = refFilterKey('remote', trackingPath)
      if (selectedRefs.has(remoteKey)) {
        continue
      }
      const remoteTip = tipByRefKey.get(remoteKey)
      if (remoteTip === localTip) {
        addTip(remoteTip)
      }
    }
  }

  return tips
}

export function computeBranchFilterSet(
  commits: GitLogEntry[],
  selectedRefs: ReadonlySet<string> | undefined,
  remoteBranches: string[] | undefined,
  remoteNames: Set<string>
): Set<string> | null {
  if (!selectedRefs || selectedRefs.size === 0) {
    return null
  }

  const tipHashes = collectTimelineTips(commits, selectedRefs, remoteBranches ?? [], remoteNames)
  if (tipHashes.length === 0) {
    return new Set()
  }
  const { byHash } = getCommitIndex(commits)
  const reachable = new Set<string>()
  for (const tip of tipHashes) {
    walkAncestors(byHash, tip, reachable)
  }
  return reachable
}

export function computeOnBranchSet(
  commits: GitLogEntry[],
  remoteNames: Set<string>,
  currentBranch: string | undefined
): Set<string> | null {
  const { tipByRefKey, headTip } = getRefTipIndex(commits, remoteNames)
  let tip = headTip
  if (!tip && currentBranch) {
    tip = tipByRefKey.get(refFilterKey('local', currentBranch))
  }
  if (!tip) {
    return null
  }

  const { byHash } = getCommitIndex(commits)
  const reachable = new Set<string>()
  walkAncestors(byHash, tip, reachable)
  return reachable
}

export function computeVisibleSet(filter: string, commits: GitLogEntry[]): Set<string> | null {
  return fuzzyMatchSet(
    filter,
    commits,
    ['message', 'hash', 'author_name', 'refs'],
    (commit) => commit.hash
  )
}

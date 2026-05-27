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

function buildCommitByHash(commits: GitLogEntry[]): Map<string, GitLogEntry> {
  const byHash = new Map<string, GitLogEntry>()
  for (const commit of commits) {
    byHash.set(commit.hash, commit)
  }
  return byHash
}

function computeReachableSet(commits: GitLogEntry[], tipHashes: string[]): Set<string> {
  const byHash = buildCommitByHash(commits)
  const reachable = new Set<string>()
  const stack = [...tipHashes]
  while (stack.length > 0) {
    const hash = stack.pop() as string
    if (reachable.has(hash)) {
      continue
    }
    reachable.add(hash)
    const commit = byHash.get(hash)
    if (!commit) {
      continue
    }
    for (const parent of commit.parents) {
      stack.push(parent)
    }
  }
  return reachable
}

export function findRefTip(
  commits: GitLogEntry[],
  refKind: RefKind,
  fullPath: string,
  remoteNames: Set<string>
): string | undefined {
  for (const commit of commits) {
    if (!commit.refs) {
      continue
    }
    const parsed = parseRefs(commit.refs, remoteNames)
    for (const ref of parsed) {
      if (refKind === 'local' && ref.kind === 'branch' && ref.label === fullPath) {
        return commit.hash
      }
      if (refKind === 'remote' && ref.kind === 'remote' && ref.label === fullPath) {
        return commit.hash
      }
    }
  }
  return undefined
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

export function pruneAncestorTips(commits: GitLogEntry[], tipHashes: string[]): string[] {
  const reachability = new Map<string, Set<string>>()
  for (const tip of tipHashes) {
    reachability.set(tip, computeReachableSet(commits, [tip]))
  }
  return tipHashes.filter((tip) => {
    for (const other of tipHashes) {
      if (tip === other) {
        continue
      }
      if (reachability.get(other)?.has(tip)) {
        return false
      }
    }
    return true
  })
}

function collectTimelineTips(
  commits: GitLogEntry[],
  selectedRefs: ReadonlySet<string>,
  remoteBranches: readonly string[],
  remoteNames: Set<string>
): string[] {
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
    addTip(findRefTip(commits, parsed.kind, parsed.fullPath, remoteNames))
  }

  for (const key of selectedRefs) {
    const parsed = parseFilterRefKey(key)
    if (!parsed || parsed.kind !== 'local') {
      continue
    }
    const localTip = findRefTip(commits, 'local', parsed.fullPath, remoteNames)
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
      const remoteTip = findRefTip(commits, 'remote', trackingPath, remoteNames)
      if (remoteTip === localTip) {
        addTip(remoteTip)
      }
    }
  }

  return pruneAncestorTips(commits, tips)
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
  return computeReachableSet(commits, tipHashes)
}

export function computeOnBranchSet(
  commits: GitLogEntry[],
  remoteNames: Set<string>,
  currentBranch: string | undefined
): Set<string> | null {
  let tip: string | undefined
  for (const commit of commits) {
    if (!commit.refs) {
      continue
    }
    const hasHead = commit.refs.split(',').some((part) => {
      const trimmed = part.trim()
      return trimmed === 'HEAD' || trimmed.startsWith('HEAD -> ')
    })
    if (hasHead) {
      tip = commit.hash
      break
    }
  }
  if (!tip && currentBranch) {
    for (const commit of commits) {
      if (!commit.refs) {
        continue
      }
      const parsed = parseRefs(commit.refs, remoteNames)
      if (parsed.some((ref) => ref.kind === 'branch' && ref.label === currentBranch)) {
        tip = commit.hash
        break
      }
    }
  }
  if (!tip) {
    return null
  }

  return computeReachableSet(commits, [tip])
}

export function computeVisibleSet(filter: string, commits: GitLogEntry[]): Set<string> | null {
  return fuzzyMatchSet(
    filter,
    commits,
    ['message', 'hash', 'author_name', 'refs'],
    (commit) => commit.hash
  )
}

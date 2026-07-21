import { GIT_LOG_REF_SEPARATOR } from '@shared/schemas/git'
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
  fallbackTagTips: string[]
}

const refTipIndexCache = new WeakMap<GitLogEntry[], Map<string, RefTipIndex>>()

function remoteNamesKey(remoteNames: ReadonlySet<string> | undefined): string {
  return remoteNames ? JSON.stringify([...remoteNames].sort()) : 'undefined'
}

function hasHeadMarker(refs: string): boolean {
  return refs.split(GIT_LOG_REF_SEPARATOR).some((part) => {
    const trimmed = part.trim()
    return trimmed === 'HEAD' || trimmed.startsWith('HEAD -> ')
  })
}

export function getRefTipIndex(commits: GitLogEntry[], remoteNames?: Set<string>): RefTipIndex {
  const cacheKey = remoteNamesKey(remoteNames)
  const cached = refTipIndexCache.get(commits)?.get(cacheKey)
  if (cached) {
    return cached
  }
  const tipByRefKey = new Map<string, string>()
  let headTip: string | undefined
  const branchTips: string[] = []
  const tagTips: string[] = []
  const seenBranchTips = new Set<string>()
  const seenTagTips = new Set<string>()
  for (const commit of commits) {
    if (!commit.refs) {
      continue
    }
    if (headTip === undefined && hasHeadMarker(commit.refs)) {
      headTip = commit.hash
    }
    for (const ref of parseRefs(commit.refs, remoteNames)) {
      if (ref.kind === 'tag') {
        if (!seenTagTips.has(commit.hash)) {
          seenTagTips.add(commit.hash)
          tagTips.push(commit.hash)
        }
        continue
      }
      if (ref.kind !== 'branch' && ref.kind !== 'remote') {
        continue
      }
      if (!seenBranchTips.has(commit.hash)) {
        seenBranchTips.add(commit.hash)
        branchTips.push(commit.hash)
      }
      const key = refFilterKey(ref.kind === 'branch' ? 'local' : 'remote', ref.label)
      if (!tipByRefKey.has(key)) {
        tipByRefKey.set(key, commit.hash)
      }
    }
  }
  let fallbackTagTips: string[] = []
  if (tagTips.length > 0) {
    const { byHash } = getCommitIndex(commits)
    const reachableFromBranches = new Set<string>()
    for (const tip of branchTips) {
      walkAncestors(byHash, tip, reachableFromBranches)
    }
    fallbackTagTips = pruneAncestorTips(
      commits,
      tagTips.filter((tip) => !reachableFromBranches.has(tip))
    )
  }
  const index = { tipByRefKey, headTip, fallbackTagTips }
  const entries = refTipIndexCache.get(commits) ?? new Map<string, RefTipIndex>()
  entries.set(cacheKey, index)
  refTipIndexCache.set(commits, entries)
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

export function collectTimelineTips(
  commits: GitLogEntry[],
  selectedRefs: ReadonlySet<string>,
  remoteBranches: readonly string[],
  remoteNames: Set<string>,
  currentBranch?: string
): string[] {
  const { tipByRefKey, headTip, fallbackTagTips } = getRefTipIndex(commits, remoteNames)
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

  if (currentBranch === '') {
    addTip(headTip)
  }

  if (currentBranch !== undefined && fallbackTagTips.length > 0) {
    let reachableFromDetachedHead: Set<string> | undefined
    if (currentBranch === '' && headTip) {
      reachableFromDetachedHead = new Set()
      walkAncestors(getCommitIndex(commits).byHash, headTip, reachableFromDetachedHead)
    }
    for (const tip of fallbackTagTips) {
      if (reachableFromDetachedHead?.has(tip)) {
        continue
      }
      addTip(tip)
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

function firstParentLine(
  byHash: Map<string, GitLogEntry>,
  start: string,
  boundary: ReadonlySet<string>,
  out: Set<string>
): void {
  let cursor: string | undefined = start
  while (cursor !== undefined && !boundary.has(cursor) && !out.has(cursor)) {
    const commit = byHash.get(cursor)
    if (!commit) {
      return
    }
    out.add(cursor)
    cursor = commit.parents[0]
  }
}

const NO_BOUNDARY: ReadonlySet<string> = new Set()

export function computeMainlineSet(commits: GitLogEntry[], tips: readonly string[]): Set<string> {
  const { byHash } = getCommitIndex(commits)
  const mainline = new Set<string>()
  for (const tip of tips) {
    firstParentLine(byHash, tip, NO_BOUNDARY, mainline)
  }
  return mainline
}

export function sideRange(
  commits: GitLogEntry[],
  merge: GitLogEntry,
  boundary: ReadonlySet<string>
): Set<string> {
  const { byHash } = getCommitIndex(commits)
  const revealed = new Set<string>()
  for (let parentIndex = 1; parentIndex < merge.parents.length; parentIndex++) {
    firstParentLine(byHash, merge.parents[parentIndex], boundary, revealed)
  }
  return revealed
}

// A merge is only revealed once it is itself displayed, so expanding an outer merge can make a
// nested one eligible; iterate to a fixpoint. Stale entries (a merge no longer displayed) are
// skipped because their merge commit never enters `displayed`.
export function computeCollapsedView(
  commits: GitLogEntry[],
  tips: readonly string[],
  expandedMerges: ReadonlySet<string>
): Set<string> {
  const { byHash, positionByHash } = getCommitIndex(commits)
  const displayed = computeMainlineSet(commits, tips)
  if (expandedMerges.size === 0) {
    return displayed
  }
  const pending = [...expandedMerges].sort(
    (left, right) => (positionByHash.get(left) ?? 0) - (positionByHash.get(right) ?? 0)
  )
  let revealedSomething = true
  while (revealedSomething) {
    revealedSomething = false
    for (let index = 0; index < pending.length; index++) {
      const mergeHash = pending[index]
      if (mergeHash === undefined || !displayed.has(mergeHash)) {
        continue
      }
      const merge = byHash.get(mergeHash)
      pending[index] = undefined as unknown as string
      if (!merge || merge.parents.length < 2) {
        continue
      }
      for (const hash of sideRange(commits, merge, displayed)) {
        displayed.add(hash)
        revealedSomething = true
      }
    }
  }
  return displayed
}

// The set of merges to expand so every reachable match becomes displayed — the full chain from a
// visible Mainline down to each match. A single children-first pass (a merge's container is always
// its descendant, so it appears earlier) builds `revealedBy`, mapping each hidden commit to the
// merge that directly surfaces it; walking that chain up from a match collects its whole reveal
// path. Matches already on the Mainline or unreachable under these tips contribute nothing.
export function computeMergesToReveal(
  commits: GitLogEntry[],
  tips: readonly string[],
  matchSet: ReadonlySet<string>
): Set<string> {
  const result = new Set<string>()
  if (matchSet.size === 0) {
    return result
  }
  const displayed = computeMainlineSet(commits, tips)
  const revealedBy = new Map<string, string>()
  for (const commit of commits) {
    if (commit.parents.length < 2 || !displayed.has(commit.hash)) {
      continue
    }
    for (const hash of sideRange(commits, commit, displayed)) {
      if (!displayed.has(hash)) {
        displayed.add(hash)
        revealedBy.set(hash, commit.hash)
      }
    }
  }
  for (const match of matchSet) {
    let cursor: string | undefined = match
    while (cursor !== undefined && revealedBy.has(cursor)) {
      const merge = revealedBy.get(cursor) as string
      result.add(merge)
      cursor = merge
    }
  }
  return result
}

export type MergeGlyph = 'collapsed' | 'expanded' | 'none'

export function mergeGlyphState(
  commits: GitLogEntry[],
  merge: GitLogEntry,
  displayedSet: ReadonlySet<string>,
  expandedMerges: ReadonlySet<string>,
  expansionBoundary: ReadonlySet<string> = displayedSet
): MergeGlyph {
  if (merge.parents.length < 2 || !displayedSet.has(merge.hash)) {
    return 'none'
  }
  if (sideRange(commits, merge, expansionBoundary).size === 0) {
    return 'none'
  }
  if (expandedMerges.has(merge.hash)) {
    return 'expanded'
  }
  return 'collapsed'
}

export interface MergeSideRange {
  commits: ReadonlySet<string>
  glyph: Exclude<MergeGlyph, 'none'>
}

export function computeMergeSideRangeIndex(
  commits: GitLogEntry[],
  displayedCommits: GitLogEntry[],
  displayedSet: ReadonlySet<string>,
  expandedMerges: ReadonlySet<string>,
  tips: readonly string[] = []
): ReadonlyMap<string, MergeSideRange> {
  const sideRanges = new Map<string, MergeSideRange>()
  const independentBoundary =
    tips.length > 0 ? computeCollapsedView(commits, tips, new Set()) : displayedSet
  for (const commit of displayedCommits) {
    if (commit.parents.length < 2) {
      continue
    }
    const range = sideRange(commits, commit, independentBoundary)
    if (range.size === 0) {
      continue
    }
    if (expandedMerges.has(commit.hash)) {
      sideRanges.set(commit.hash, { commits: range, glyph: 'expanded' })
      continue
    }
    let hiddenCommit = false
    for (const hash of range) {
      if (!displayedSet.has(hash)) {
        hiddenCommit = true
        break
      }
    }
    if (hiddenCommit) {
      sideRanges.set(commit.hash, { commits: range, glyph: 'collapsed' })
    }
  }
  return sideRanges
}

export function computeVisibleSet(filter: string, commits: GitLogEntry[]): Set<string> | null {
  return fuzzyMatchSet(
    filter,
    commits,
    ['message', 'hash', 'author_name', 'refs'],
    (commit) => commit.hash
  )
}

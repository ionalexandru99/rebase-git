import type { RepoChangeKind } from '@shared/schemas/git'

export type RepoCache = 'status' | 'localBranches' | 'remoteRefs' | 'log' | 'stash' | 'diff'

// Keyed by the typed RPC operation tag. Stays renderer-side: cache invalidation is a renderer
// concern and must never cross the wire into the shared contract.
const OPERATION_CACHES = {
  // History ops move HEAD or rewrite the graph: they touch the working tree, the refs, and the
  // timeline (log). checkout is the union too — switching HEAD changes the working tree and which
  // commits the log shows. createBranchCheckout is the same footprint; a plain createBranch only
  // adds a ref. createBranchCheckout is a renderer-side key, not an RPC tag: both modes share the
  // createBranch RPC, split only by their cache footprint.
  commit: ['status', 'localBranches', 'diff', 'log'],
  push: ['localBranches', 'remoteRefs'],
  pull: ['status', 'localBranches', 'remoteRefs', 'diff', 'log'],
  mergeBranch: ['status', 'localBranches', 'remoteRefs', 'diff', 'log'],
  reset: ['status', 'localBranches', 'remoteRefs', 'diff', 'log'],
  revertCommit: ['status', 'localBranches', 'remoteRefs', 'diff', 'log'],
  cherryPick: ['status', 'localBranches', 'remoteRefs', 'diff', 'log'],
  checkout: ['status', 'localBranches', 'remoteRefs', 'diff', 'log'],
  createBranchCheckout: ['status', 'localBranches', 'remoteRefs', 'diff', 'log'],
  createBranch: ['localBranches', 'remoteRefs'],
  deleteBranch: ['localBranches', 'remoteRefs'],
  renameBranch: ['localBranches', 'remoteRefs'],
  createTag: ['localBranches', 'remoteRefs'],
  deleteTag: ['localBranches', 'remoteRefs'],
  discardChanges: ['status', 'diff', 'stash'],
  discardAll: ['status', 'diff', 'stash'],
  stashPush: ['status', 'diff', 'stash'],
  stashApply: ['status', 'diff', 'stash'],
  stashPop: ['status', 'diff', 'stash'],
  stashDrop: ['stash']
} satisfies Record<string, readonly RepoCache[]>

export type MappedOperation = keyof typeof OPERATION_CACHES

export const cachesForOperation = (operation: MappedOperation): readonly RepoCache[] =>
  OPERATION_CACHES[operation]

const REPO_CHANGE_CACHES = {
  refs: ['localBranches', 'remoteRefs', 'log', 'stash'],
  workingTree: ['status', 'diff', 'stash'],
  index: ['status', 'diff', 'stash']
} satisfies Record<RepoChangeKind, readonly RepoCache[]>

export const cachesForRepoChange = (kind: RepoChangeKind): readonly RepoCache[] =>
  REPO_CHANGE_CACHES[kind]

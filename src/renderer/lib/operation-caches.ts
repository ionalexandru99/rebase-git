export type RepoCache = 'status' | 'localBranches' | 'remoteRefs' | 'log' | 'stash' | 'diff'

// Keyed by the typed RPC operation tag. Stays renderer-side: cache invalidation is a renderer
// concern and must never cross the wire into the shared contract.
const OPERATION_CACHES = {
  // History ops move HEAD or rewrite the graph: they touch the working tree, the refs, and the
  // timeline (log). createBranchCheckout is the union too — checking out the new branch can change
  // the working tree; a plain createBranch only adds a ref. createBranchCheckout is a renderer-side
  // key, not an RPC tag: both modes share the createBranch RPC, split only by their cache footprint.
  mergeBranch: ['status', 'localBranches', 'remoteRefs', 'diff', 'log'],
  reset: ['status', 'localBranches', 'remoteRefs', 'diff', 'log'],
  revertCommit: ['status', 'localBranches', 'remoteRefs', 'diff', 'log'],
  cherryPick: ['status', 'localBranches', 'remoteRefs', 'diff', 'log'],
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

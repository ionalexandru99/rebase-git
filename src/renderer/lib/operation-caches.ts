export type RepoCache = 'status' | 'localBranches' | 'remoteRefs' | 'log' | 'stash' | 'diff'

// Keyed by the typed RPC operation tag. Stays renderer-side: cache invalidation is a renderer
// concern and must never cross the wire into the shared contract.
const OPERATION_CACHES = {
  // History ops move HEAD or rewrite the graph: they touch the working tree, the refs, and the
  // timeline (log). createBranch is the union too — branch+checkout can change the working tree.
  mergeBranch: ['status', 'localBranches', 'remoteRefs', 'diff', 'log'],
  reset: ['status', 'localBranches', 'remoteRefs', 'diff', 'log'],
  revertCommit: ['status', 'localBranches', 'remoteRefs', 'diff', 'log'],
  cherryPick: ['status', 'localBranches', 'remoteRefs', 'diff', 'log'],
  createBranch: ['status', 'localBranches', 'remoteRefs', 'diff', 'log'],
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

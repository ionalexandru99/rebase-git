export type RepoCache = 'status' | 'localBranches' | 'remoteRefs' | 'log' | 'stash' | 'diff'

// Keyed by the typed RPC operation tag. Stays renderer-side: cache invalidation is a renderer
// concern and must never cross the wire into the shared contract.
const OPERATION_CACHES = {
  deleteBranch: ['localBranches', 'remoteRefs'],
  renameBranch: ['localBranches', 'remoteRefs'],
  deleteTag: ['localBranches', 'remoteRefs'],
  discardChanges: ['status', 'diff', 'stash'],
  discardAll: ['status', 'diff', 'stash'],
  stashPush: ['status', 'diff', 'stash'],
  stashDrop: ['stash']
} satisfies Record<string, readonly RepoCache[]>

export type MappedOperation = keyof typeof OPERATION_CACHES

export const cachesForOperation = (operation: MappedOperation): readonly RepoCache[] =>
  OPERATION_CACHES[operation]

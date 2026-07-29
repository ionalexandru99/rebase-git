import type { SidecarRpcTag } from '@shared/rpc'
import type { RepoChangeKind } from '@shared/schemas/git'

export type RepoCache =
  | 'status'
  | 'localBranches'
  | 'remoteRefs'
  | 'log'
  | 'stash'
  | 'diff'
  | 'headCommit'

const OPERATION_CACHES = {
  openRepo: null,
  closeRepo: null,
  scanForRepos: null,
  cloneRepo: null,
  commit: ['status', 'localBranches', 'diff', 'log', 'headCommit'],
  getHeadCommit: null,
  amendCommit: ['status', 'localBranches', 'remoteRefs', 'diff', 'log', 'headCommit'],
  stageFile: null,
  unstageFile: null,
  stageAll: null,
  unstageAll: null,
  stageHunk: null,
  unstageHunk: null,
  discardChanges: ['status', 'diff', 'stash'],
  discardAll: ['status', 'diff', 'stash'],
  mergeBranch: ['status', 'localBranches', 'remoteRefs', 'diff', 'log', 'headCommit'],
  revertCommit: ['status', 'localBranches', 'remoteRefs', 'diff', 'log', 'headCommit'],
  cherryPick: ['status', 'localBranches', 'remoteRefs', 'diff', 'log', 'headCommit'],
  checkout: ['status', 'localBranches', 'remoteRefs', 'diff', 'log', 'headCommit'],
  createBranch: ['localBranches', 'remoteRefs'],
  deleteBranch: ['localBranches', 'remoteRefs'],
  renameBranch: ['localBranches', 'remoteRefs'],
  createTag: ['localBranches', 'remoteRefs'],
  deleteTag: ['localBranches', 'remoteRefs'],
  stashPop: ['status', 'diff', 'stash'],
  stashApply: ['status', 'diff', 'stash'],
  stashDrop: ['stash'],
  stashPush: ['status', 'diff', 'stash'],
  reset: ['status', 'localBranches', 'remoteRefs', 'diff', 'log', 'headCommit'],
  fetch: null,
  push: ['localBranches', 'remoteRefs', 'log'],
  pull: ['status', 'localBranches', 'remoteRefs', 'diff', 'log', 'headCommit'],
  getStatus: null,
  getLocalBranches: null,
  getRemoteRefs: null,
  getDiff: null,
  getCommitDetail: null,
  stashList: null,
  streamLog: null,
  abortOperation: ['status', 'localBranches', 'remoteRefs', 'diff', 'log', 'headCommit'],
  continueOperation: ['status', 'localBranches', 'remoteRefs', 'diff', 'log', 'headCommit'],
  resolveConflict: ['status', 'diff'],
  createBranchCheckout: ['status', 'localBranches', 'remoteRefs', 'diff', 'log', 'headCommit']
} satisfies Record<SidecarRpcTag | 'createBranchCheckout', readonly RepoCache[] | null>

export type MappedOperation = {
  [Operation in keyof typeof OPERATION_CACHES]: (typeof OPERATION_CACHES)[Operation] extends readonly RepoCache[]
    ? Operation
    : never
}[keyof typeof OPERATION_CACHES]

export const cachesForOperation = (operation: MappedOperation): readonly RepoCache[] => {
  const caches = OPERATION_CACHES[operation]
  if (caches === null) {
    throw new Error(`No caches mapped for ${operation}`)
  }
  return caches
}

const REPO_CHANGE_CACHES = {
  refs: ['localBranches', 'remoteRefs', 'log', 'stash', 'headCommit'],
  workingTree: ['status', 'diff', 'stash'],
  index: ['status', 'diff', 'stash']
} satisfies Record<RepoChangeKind, readonly RepoCache[]>

export const cachesForRepoChange = (kind: RepoChangeKind): readonly RepoCache[] =>
  REPO_CHANGE_CACHES[kind]

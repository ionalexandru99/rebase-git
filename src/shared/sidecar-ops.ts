export const SidecarOp = {
  openRepo: 'open-repo',
  closeRepo: 'close-repo',
  getBranches: 'get-branches',
  getLocalBranches: 'get-local-branches',
  getRemoteRefs: 'get-remote-refs',
  getStatus: 'get-status',
  getDiff: 'get-diff',
  fetchRepo: 'fetch-repo',
  pushRepo: 'push-repo',
  pullRepo: 'pull-repo',
  getLog: 'get-log',
  resetToCommit: 'reset-to-commit',
  stashList: 'stash-list',
  stashPush: 'stash-push',
  stashApply: 'stash-apply',
  stashPop: 'stash-pop',
  stashDrop: 'stash-drop',
  scanForRepos: 'scan-for-repos'
} as const

export type SidecarOpName = (typeof SidecarOp)[keyof typeof SidecarOp]

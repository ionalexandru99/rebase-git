export const SidecarOp = {
  openRepo: 'open-repo',
  closeRepo: 'close-repo',
  getBranches: 'get-branches',
  getLocalBranches: 'get-local-branches',
  getRemoteRefs: 'get-remote-refs',
  getStatus: 'get-status',
  stageFile: 'stage-file',
  unstageFile: 'unstage-file',
  stageAll: 'stage-all',
  unstageAll: 'unstage-all',
  commit: 'commit',
  getDiff: 'get-diff',
  stageHunk: 'stage-hunk',
  unstageHunk: 'unstage-hunk',
  fetchRepo: 'fetch-repo',
  getLog: 'get-log',
  checkoutRef: 'checkout-ref',
  scanForRepos: 'scan-for-repos'
} as const

export type SidecarOpName = (typeof SidecarOp)[keyof typeof SidecarOp]

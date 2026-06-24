export const SidecarOp = {
  getBranches: 'get-branches',
  getLocalBranches: 'get-local-branches',
  getRemoteRefs: 'get-remote-refs',
  getStatus: 'get-status',
  getDiff: 'get-diff',
  getLog: 'get-log',
  stashList: 'stash-list'
} as const

export type SidecarOpName = (typeof SidecarOp)[keyof typeof SidecarOp]

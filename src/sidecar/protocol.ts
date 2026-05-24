export const SidecarOp = {
  openRepo: 'open-repo',
  closeRepo: 'close-repo',
  getBranches: 'get-branches',
  getStatus: 'get-status',
  stageFile: 'stage-file',
  unstageFile: 'unstage-file',
  commit: 'commit',
  fetchRepo: 'fetch-repo',
  getLog: 'get-log',
  checkoutRef: 'checkout-ref',
  scanForRepos: 'scan-for-repos'
} as const

export type SidecarOpName = (typeof SidecarOp)[keyof typeof SidecarOp]

export type SidecarStartMessage = {
  type: 'start'
  hostname: string
  port: number
  token: string
}
export type SidecarStopMessage = { type: 'stop' }
export type SidecarCommand = SidecarStartMessage | SidecarStopMessage

export type SidecarReadyMessage = { type: 'ready' }
export type SidecarErrorMessage = { type: 'error'; message: string }
export type SidecarMessage = SidecarReadyMessage | SidecarErrorMessage

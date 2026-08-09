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

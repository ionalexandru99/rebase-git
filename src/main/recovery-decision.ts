export type RecoveryAction = 'wait' | 'reload' | 'export-logs' | 'quit'

export const RECOVERY_ACTIONS: readonly RecoveryAction[] = ['wait', 'reload', 'export-logs', 'quit']

export const RECOVERY_BUTTONS: readonly string[] = [
  'Keep Waiting',
  'Reload',
  'Export Logs…',
  'Quit'
]

export function recoveryActionForResponse(response: number): RecoveryAction {
  return RECOVERY_ACTIONS[response] ?? 'wait'
}

export function shouldPromptOnRenderGone(reason: string): boolean {
  return reason !== 'clean-exit'
}

export const SIDECAR_SERVICE_NAME = 'rebase git sidecar'

export function shouldRespawnSidecar(details: {
  type?: string
  serviceName?: string
  name?: string
}): boolean {
  if (details.name === SIDECAR_SERVICE_NAME || details.serviceName === SIDECAR_SERVICE_NAME) {
    return true
  }
  return details.type === 'Utility' && !details.name && !details.serviceName
}

interface ChildProcessGoneDetails {
  type?: string
  serviceName?: string
  name?: string
  reason?: string
}

interface ChildProcessRecoveryState {
  appShuttingDown: boolean
}

export interface ChildProcessRecoveryDecision {
  log: boolean
  respawn: boolean
}

export function childProcessRecoveryDecision(
  details: ChildProcessGoneDetails,
  state: ChildProcessRecoveryState
): ChildProcessRecoveryDecision {
  if (state.appShuttingDown) {
    return { log: false, respawn: false }
  }

  const sidecar = shouldRespawnSidecar(details)
  if (sidecar && details.reason === 'clean-exit') {
    return { log: false, respawn: false }
  }

  return { log: true, respawn: sidecar }
}

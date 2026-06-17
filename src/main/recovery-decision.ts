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

const SIDECAR_SERVICE_NAME = 'rebase git sidecar'

// Electron surfaces the `utilityProcess.fork` serviceName option as `details.name`; `serviceName`
// holds the non-localized service id (e.g. `node.mojom.NodeService`). Match `name` first, keep the
// id as a defensive fallback, and otherwise only respawn an anonymous utility child.
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

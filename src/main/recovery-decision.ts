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

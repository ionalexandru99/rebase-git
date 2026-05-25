import { describe, expect, it } from 'vitest'
import {
  RECOVERY_BUTTONS,
  recoveryActionForResponse,
  shouldPromptOnRenderGone
} from '../recovery-decision'

describe('recoveryActionForResponse', () => {
  it('maps each dialog button index to its action', () => {
    expect(recoveryActionForResponse(0)).toBe('wait')
    expect(recoveryActionForResponse(1)).toBe('reload')
    expect(recoveryActionForResponse(2)).toBe('export-logs')
    expect(recoveryActionForResponse(3)).toBe('quit')
  })

  it('falls back to waiting for an out-of-range or dismissed response', () => {
    expect(recoveryActionForResponse(-1)).toBe('wait')
    expect(recoveryActionForResponse(99)).toBe('wait')
  })

  it('keeps the button labels aligned with the action order', () => {
    expect(RECOVERY_BUTTONS).toHaveLength(4)
    expect(RECOVERY_BUTTONS[1]).toBe('Reload')
  })
})

describe('shouldPromptOnRenderGone', () => {
  it('prompts for crashes but not for a clean exit', () => {
    expect(shouldPromptOnRenderGone('crashed')).toBe(true)
    expect(shouldPromptOnRenderGone('oom')).toBe(true)
    expect(shouldPromptOnRenderGone('clean-exit')).toBe(false)
  })
})

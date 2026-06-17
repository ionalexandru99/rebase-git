import { describe, expect, it } from 'vitest'
import {
  RECOVERY_BUTTONS,
  recoveryActionForResponse,
  shouldPromptOnRenderGone,
  shouldRespawnSidecar
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

describe('shouldRespawnSidecar', () => {
  it('respawns when the gone child is the named git sidecar', () => {
    expect(shouldRespawnSidecar({ type: 'Utility', serviceName: 'rebase git sidecar' })).toBe(true)
  })

  it('respawns a utility child with no service name', () => {
    expect(shouldRespawnSidecar({ type: 'Utility' })).toBe(true)
  })

  it('does not respawn for a GPU process', () => {
    expect(shouldRespawnSidecar({ type: 'GPU' })).toBe(false)
  })

  it('does not respawn for an unrelated named utility service', () => {
    expect(shouldRespawnSidecar({ type: 'Utility', serviceName: 'Network Service' })).toBe(false)
  })

  it('does not respawn for a zygote or unknown child without a service name', () => {
    expect(shouldRespawnSidecar({ type: 'Zygote' })).toBe(false)
    expect(shouldRespawnSidecar({})).toBe(false)
  })
})

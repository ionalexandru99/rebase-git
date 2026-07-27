import { describe, expect, it } from 'vitest'
import { applyNonInteractiveGitEnv } from '../environment'

describe('applyNonInteractiveGitEnv', () => {
  it('suppresses prompts and pins the language failures are reported in', () => {
    const env = applyNonInteractiveGitEnv({})

    expect(env.GIT_TERMINAL_PROMPT).toBe('0')
    expect(env.LC_ALL).toBe('C')
  })

  it('strips the desktop askpass helpers that would hang a spawned git on a dialog', () => {
    const env = applyNonInteractiveGitEnv({
      GIT_ASKPASS: '/usr/bin/ksshaskpass',
      SSH_ASKPASS: '/usr/bin/ksshaskpass'
    })

    expect(env.GIT_ASKPASS).toBeUndefined()
    expect(env.SSH_ASKPASS).toBeUndefined()
  })

  it('empties core.askpass so a configured helper cannot take over either', () => {
    const env = applyNonInteractiveGitEnv({})

    expect(env.GIT_CONFIG_COUNT).toBe('1')
    expect(env.GIT_CONFIG_KEY_0).toBe('core.askpass')
    expect(env.GIT_CONFIG_VALUE_0).toBe('')
  })

  it('keeps config entries the caller already declared', () => {
    const env = applyNonInteractiveGitEnv({
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'protocol.version',
      GIT_CONFIG_VALUE_0: '2'
    })

    expect(env.GIT_CONFIG_KEY_0).toBe('protocol.version')
    expect(env.GIT_CONFIG_VALUE_0).toBe('2')
    expect(env.GIT_CONFIG_COUNT).toBe('2')
    expect(env.GIT_CONFIG_KEY_1).toBe('core.askpass')
    expect(env.GIT_CONFIG_VALUE_1).toBe('')
  })

  it('puts ssh in batch mode, keeping a custom ssh command', () => {
    expect(applyNonInteractiveGitEnv({}).GIT_SSH_COMMAND).toBe('ssh -o BatchMode=yes')
    expect(
      applyNonInteractiveGitEnv({ GIT_SSH_COMMAND: 'ssh -i ~/.ssh/work' }).GIT_SSH_COMMAND
    ).toBe('ssh -i ~/.ssh/work -o BatchMode=yes')
  })

  it('is idempotent, so a per-call copy of an already-prepared environment stays clean', () => {
    const once = applyNonInteractiveGitEnv({ SSH_ASKPASS: '/usr/bin/ksshaskpass' })
    const twice = applyNonInteractiveGitEnv({ ...once })

    expect(twice).toEqual(once)
  })
})

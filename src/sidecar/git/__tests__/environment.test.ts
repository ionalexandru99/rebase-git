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

  it('puts ssh in batch mode, keeping a custom ssh command', () => {
    expect(applyNonInteractiveGitEnv({}).GIT_SSH_COMMAND).toBe('ssh -o BatchMode=yes')
    expect(
      applyNonInteractiveGitEnv({ GIT_SSH_COMMAND: 'ssh -i ~/.ssh/work' }).GIT_SSH_COMMAND
    ).toBe('ssh -i ~/.ssh/work -o BatchMode=yes')
  })

  // Windows drops empty-valued environment variables, so an empty value must never be load-bearing:
  // git aborts with "missing config value" when its config protocol declares a key without one.
  it('leaves no empty-valued variable behind', () => {
    const env = applyNonInteractiveGitEnv({ GIT_ASKPASS: '/usr/bin/ksshaskpass' })

    for (const [name, value] of Object.entries(env)) {
      expect(value, name).not.toBe('')
    }
    expect(env.GIT_CONFIG_COUNT).toBeUndefined()
  })

  it('is idempotent, so a per-call copy of an already-prepared environment stays clean', () => {
    const once = applyNonInteractiveGitEnv({ SSH_ASKPASS: '/usr/bin/ksshaskpass' })
    const twice = applyNonInteractiveGitEnv({ ...once })

    expect(twice).toEqual(once)
  })
})

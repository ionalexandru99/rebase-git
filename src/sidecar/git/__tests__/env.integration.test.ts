import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { promptlessEnv } from '../env'

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

describe('promptlessEnv', () => {
  it('closes every interactive prompt route git and ssh could take', () => {
    process.env.SSH_ASKPASS = '/usr/bin/ksshaskpass'
    const env = promptlessEnv()

    expect(env.GIT_TERMINAL_PROMPT).toBe('0')
    expect(env.GIT_ASKPASS).toBe('')
    expect(env.SSH_ASKPASS_REQUIRE).toBe('never')
    expect('SSH_ASKPASS' in env).toBe(false)
  })

  it('leaves the rest of the environment alone', () => {
    process.env.REBASE_ENV_PROBE = 'kept'
    expect(promptlessEnv().REBASE_ENV_PROBE).toBe('kept')
  })

  // The regression this guards: with a desktop askpass helper exported (KDE and GNOME both do it),
  // a clone that needs credentials opened an OS password window from the sidecar and waited on it
  // forever. The assertion is that git exits on its own — a hang shows up as a timeout kill.
  it('makes a clone that needs credentials exit instead of waiting on an askpass window', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-askpass-'))
    try {
      const result = spawnSync(
        'git',
        [
          'clone',
          '--',
          'https://github.com/ionalexandru99/no-such-repository.git',
          path.join(parent, 'never-created')
        ],
        {
          env: { ...promptlessEnv(), SSH_ASKPASS: '/usr/bin/ksshaskpass' },
          timeout: 20_000,
          encoding: 'utf8'
        }
      )

      expect(result.signal).toBeNull()
      expect(result.status).not.toBe(0)
      expect(result.stderr.trim().length).toBeGreaterThan(0)
    } finally {
      fs.rmSync(parent, { recursive: true, force: true })
    }
  })
})

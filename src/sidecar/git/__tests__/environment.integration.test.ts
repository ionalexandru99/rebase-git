import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyNonInteractiveGitEnv } from '../environment'

// What the environment contains is covered next door in environment.test.ts. This is the behaviour
// those variables exist for, against a real git: with a desktop askpass helper exported — KDE and
// GNOME both do it — a clone that needs credentials used to open an OS password window from the
// sidecar and wait on it forever. A clone left waiting on that window shows up here as a timeout
// kill rather than an exit, which is why the assertion is about how git ended and not what it said.
describe('a clone that needs credentials', () => {
  it('exits instead of waiting on an askpass window', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-askpass-'))
    try {
      const result = spawnSync(
        'git',
        [
          // The same command line the sidecar's spawn helper builds.
          '-c',
          'core.askpass=',
          'clone',
          '--',
          'https://github.com/ionalexandru99/no-such-repository.git',
          path.join(parent, 'never-created')
        ],
        {
          env: applyNonInteractiveGitEnv({
            ...process.env,
            SSH_ASKPASS: '/usr/bin/ksshaskpass'
          }),
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

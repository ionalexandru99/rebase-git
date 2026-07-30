import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runGit } from '../spawn'

function repoWithAskpass(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-askpass-'))
  fs.mkdirSync(path.join(repo, 'sub'), { recursive: true })
  return repo
}

describe('non-interactive git', () => {
  it('empties core.askpass on every command it spawns', async () => {
    const repo = repoWithAskpass()
    try {
      await runGit(['-C', repo, 'init', '-b', 'main'])
      await runGit(['-C', repo, 'config', 'core.askpass', '/usr/bin/some-gui-askpass'])

      const effective = await runGit(['-C', repo, 'config', '--get', 'core.askpass']).catch(
        (error: Error) => `rejected: ${error.message}`
      )

      expect(effective.trim()).toBe('')
    } finally {
      fs.rmSync(repo, { recursive: true, force: true })
    }
  })

  it('still runs ordinary commands with the flag in front', async () => {
    const repo = repoWithAskpass()
    try {
      await runGit(['-C', repo, 'init', '-b', 'main'])
      const branch = await runGit(['-C', repo, 'symbolic-ref', '--short', 'HEAD'])

      expect(branch.trim()).toBe('main')
    } finally {
      fs.rmSync(repo, { recursive: true, force: true })
    }
  })
})

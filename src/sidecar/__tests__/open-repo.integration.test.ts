import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeRepo, openRepo } from '../operations'

let baseDir: string
let repoDir: string

function git(dir: string, ...args: string[]): void {
  execFileSync('git', ['-C', dir, ...args])
}

beforeEach(() => {
  baseDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-open-test-')))
  repoDir = path.join(baseDir, 'repo')
  fs.mkdirSync(repoDir)
  git(repoDir, 'init', '-b', 'main')
  git(repoDir, 'config', 'user.email', 'test@example.com')
  git(repoDir, 'config', 'user.name', 'Test')
  fs.writeFileSync(path.join(repoDir, 'README.md'), '# test\n')
  git(repoDir, 'add', 'README.md')
  git(repoDir, 'commit', '-m', 'initial')
})

afterEach(async () => {
  await closeRepo(repoDir)
  fs.rmSync(baseDir, { recursive: true, force: true })
})

describe('openRepo gitdir resolution', () => {
  it('returns the repo .git as both gitDir and commonDir for a normal repo', async () => {
    const response = await openRepo(repoDir)
    expect(response._tag).toBe('Ok')
    if (response._tag === 'Ok') {
      const dotGit = fs.realpathSync.native(path.join(repoDir, '.git'))
      expect(response.result.gitDir && fs.realpathSync.native(response.result.gitDir)).toBe(dotGit)
      expect(response.result.commonDir && fs.realpathSync.native(response.result.commonDir)).toBe(
        dotGit
      )
    }
  })

  it('returns a distinct gitDir but the shared commonDir for a linked worktree', async () => {
    const worktreeDir = path.join(baseDir, 'wt')
    git(repoDir, 'worktree', 'add', worktreeDir, '-b', 'feature')
    const response = await openRepo(worktreeDir)
    expect(response._tag).toBe('Ok')
    if (response._tag === 'Ok') {
      const dotGit = fs.realpathSync.native(path.join(repoDir, '.git'))
      expect(response.result.gitDir).toBeDefined()
      expect(fs.realpathSync.native(response.result.gitDir as string)).not.toBe(
        fs.realpathSync.native(worktreeDir)
      )
      expect(fs.realpathSync.native(response.result.commonDir as string)).toBe(dotGit)
    }
    await closeRepo(worktreeDir)
  })
})

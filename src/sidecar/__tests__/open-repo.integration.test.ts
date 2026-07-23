import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeRepo, isCommitGraphTracked, openRepo } from '../operations'
import { requireOpen } from '../repo-sessions'
import { runOp } from './run-op'

let baseDir: string
let repoDir: string

function git(dir: string, ...args: string[]): void {
  execFileSync('git', ['-C', dir, ...args])
}

function commitGraphWriteProcesses(dir: string): number {
  let output = ''
  try {
    output = execFileSync('ps', ['-ax', '-o', 'command'], { encoding: 'utf8' })
  } catch {
    return 0
  }
  return output
    .split('\n')
    .filter((line) => line.includes('commit-graph') && line.includes('write') && line.includes(dir))
    .length
}

// A `git` shim that hangs on `commit-graph` and forwards everything else to the real binary, so the
// write child is reliably in flight (not racing a sub-100ms real write) when close kills it.
function installSlowGitShim(delaySeconds = 30): string {
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
  const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-git-shim-'))
  const shimPath = path.join(shimDir, 'git')
  fs.writeFileSync(
    shimPath,
    `#!/bin/sh
for arg in "$@"; do
  if [ "$arg" = "commit-graph" ]; then
    sleep ${delaySeconds}
    break
  fi
done
exec ${realGit} "$@"
`
  )
  fs.chmodSync(shimPath, 0o755)
  return shimDir
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

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
  await runOp(closeRepo(repoDir))
  fs.rmSync(baseDir, { recursive: true, force: true })
})

describe('openRepo gitdir resolution', () => {
  it('returns the repo .git as both gitDir and commonDir for a normal repo', async () => {
    const response = await runOp(openRepo(repoDir))
    const dotGit = fs.realpathSync.native(path.join(repoDir, '.git'))
    expect(response.result.gitDir && fs.realpathSync.native(response.result.gitDir)).toBe(dotGit)
    expect(response.result.commonDir && fs.realpathSync.native(response.result.commonDir)).toBe(
      dotGit
    )
  })

  it('returns a distinct gitDir but the shared commonDir for a linked worktree', async () => {
    const worktreeDir = path.join(baseDir, 'wt')
    git(repoDir, 'worktree', 'add', worktreeDir, '-b', 'feature')
    const response = await runOp(openRepo(worktreeDir))
    const dotGit = fs.realpathSync.native(path.join(repoDir, '.git'))
    expect(response.result.gitDir).toBeDefined()
    expect(fs.realpathSync.native(response.result.gitDir as string)).not.toBe(
      fs.realpathSync.native(worktreeDir)
    )
    expect(fs.realpathSync.native(response.result.commonDir as string)).toBe(dotGit)
    await runOp(closeRepo(worktreeDir))
  })

  it('stops tracking the commit-graph write after close so reopen can retry', async () => {
    await runOp(openRepo(repoDir))
    expect(isCommitGraphTracked(repoDir)).toBe(true)
    await runOp(closeRepo(repoDir))
    expect(isCommitGraphTracked(repoDir)).toBe(false)
  })

  it('re-kicks the commit-graph write on reopen rather than skipping it forever', async () => {
    await runOp(openRepo(repoDir))
    await runOp(closeRepo(repoDir))
    expect(isCommitGraphTracked(repoDir)).toBe(false)
    await runOp(openRepo(repoDir))
    expect(isCommitGraphTracked(repoDir)).toBe(true)
  })

  it('terminates an in-flight commit-graph write when the repo closes', async () => {
    const shimDir = installSlowGitShim()
    const originalPath = process.env.PATH
    process.env.PATH = `${shimDir}${path.delimiter}${originalPath}`
    try {
      await runOp(openRepo(repoDir))
      let inFlight = 0
      for (let attempt = 0; attempt < 40 && inFlight === 0; attempt++) {
        await sleep(25)
        inFlight = commitGraphWriteProcesses(repoDir)
      }
      expect(inFlight).toBeGreaterThan(0)

      await runOp(closeRepo(repoDir))
      let survivors = commitGraphWriteProcesses(repoDir)
      for (let attempt = 0; attempt < 40 && survivors > 0; attempt++) {
        await sleep(25)
        survivors = commitGraphWriteProcesses(repoDir)
      }
      expect(survivors).toBe(0)
    } finally {
      process.env.PATH = originalPath
      fs.rmSync(shimDir, { recursive: true, force: true })
    }
  }, 15000)

  it('waits for the background commit-graph write before admitting repo operations', async () => {
    const shimDir = installSlowGitShim(0.5)
    const originalPath = process.env.PATH
    process.env.PATH = `${shimDir}${path.delimiter}${originalPath}`
    try {
      await runOp(openRepo(repoDir))
      let inFlight = 0
      for (let attempt = 0; attempt < 40 && inFlight === 0; attempt++) {
        await sleep(25)
        inFlight = commitGraphWriteProcesses(repoDir)
      }
      expect(inFlight).toBeGreaterThan(0)

      let admitted = false
      const admission = runOp(requireOpen(repoDir)).then(() => {
        admitted = true
      })
      await sleep(50)
      expect(admitted).toBe(false)
      await admission
      expect(admitted).toBe(true)
    } finally {
      process.env.PATH = originalPath
      fs.rmSync(shimDir, { recursive: true, force: true })
    }
  })
})

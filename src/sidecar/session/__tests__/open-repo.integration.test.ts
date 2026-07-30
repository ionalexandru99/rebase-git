import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunningGitProcess, SpawnGitOptions } from '../../git/spawn'
import { closeRepo, isCommitGraphTracked, openRepo } from '../../operations/index'
import { processAlive, waitUntil } from '../../test-support/hanging-git'
import { makeCommitHeavyRepo, removeRepoDir } from '../../test-support/repo-fixtures'
import { runOp } from '../../test-support/run-op'
import { requireOpen } from '../sessions'

interface RecordedWrite {
  args: string[]
  running: RunningGitProcess
}

const commitGraphWrites: RecordedWrite[] = []

vi.mock('../../git/spawn', async (importOriginal) => {
  const spawn = await importOriginal<typeof import('../../git/spawn')>()
  return {
    ...spawn,
    startBackgroundGit: (args: string[], options?: SpawnGitOptions) => {
      const running = spawn.startBackgroundGit(args, options)
      if (args.includes('commit-graph')) {
        commitGraphWrites.push({ args, running })
      }
      return running
    }
  }
})

const IN_FLIGHT_WRITE_COMMITS = 500_000

let baseDir: string
let repoDir: string
let commitHeavyDir: string

function git(dir: string, ...args: string[]): void {
  execFileSync('git', ['-C', dir, ...args])
}

function commitGraphChain(dir: string): string {
  return path.join(dir, '.git', 'objects', 'info', 'commit-graphs', 'commit-graph-chain')
}

function discardCommitGraph(dir: string): void {
  fs.rmSync(path.join(dir, '.git', 'objects', 'info', 'commit-graphs'), {
    recursive: true,
    force: true
  })
  fs.rmSync(path.join(dir, '.git', 'objects', 'info', 'commit-graph'), { force: true })
}

async function commitGraphWriteFor(dir: string): Promise<RunningGitProcess> {
  const recorded = () => commitGraphWrites.find((write) => write.args.includes(dir))
  await waitUntil(() => recorded() !== undefined, 10_000, 'commit-graph write spawn')
  return (recorded() as RecordedWrite).running
}

beforeAll(() => {
  commitHeavyDir = makeCommitHeavyRepo(IN_FLIGHT_WRITE_COMMITS)
}, 300_000)

afterAll(() => {
  removeRepoDir(commitHeavyDir)
})

beforeEach(() => {
  commitGraphWrites.length = 0
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
  removeRepoDir(baseDir)
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
    discardCommitGraph(commitHeavyDir)
    try {
      await runOp(openRepo(commitHeavyDir))
      const write = await commitGraphWriteFor(commitHeavyDir)
      const writePid = write.child.pid
      expect(processAlive(writePid)).toBe(true)

      await runOp(closeRepo(commitHeavyDir))

      await waitUntil(() => !processAlive(writePid), 10_000, 'commit-graph write exit')
      const { code } = await write.result
      expect(code).not.toBe(0)
      expect(fs.existsSync(commitGraphChain(commitHeavyDir))).toBe(false)
    } finally {
      await runOp(closeRepo(commitHeavyDir))
    }
  }, 120_000)

  it('waits for the background commit-graph write before admitting repo operations', async () => {
    discardCommitGraph(commitHeavyDir)
    try {
      await runOp(openRepo(commitHeavyDir))
      const write = await commitGraphWriteFor(commitHeavyDir)
      const writePid = write.child.pid
      expect(processAlive(writePid)).toBe(true)

      await runOp(requireOpen(commitHeavyDir))

      expect(processAlive(writePid)).toBe(false)
      expect((await write.result).code).toBe(0)
      expect(fs.existsSync(commitGraphChain(commitHeavyDir))).toBe(true)
    } finally {
      await runOp(closeRepo(commitHeavyDir))
    }
  }, 120_000)
})

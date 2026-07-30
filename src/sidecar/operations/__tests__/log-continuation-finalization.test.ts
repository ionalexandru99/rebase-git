import { ManagedRuntime } from 'effect'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { RunningGitProcess, SpawnGitOptions } from '../../git/spawn'
import { processAlive, waitUntil } from '../../test-support/hanging-git'
import { makeBigRepo, removeRepoDir } from '../../test-support/repo-fixtures'
import { LogContinuations, LogContinuationsLive } from '../log-stream'

const startedGitProcesses: RunningGitProcess[] = []

vi.mock('../../git/spawn', async (importOriginal) => {
  const spawn = await importOriginal<typeof import('../../git/spawn')>()
  return {
    ...spawn,
    startGit: (args: string[], options?: SpawnGitOptions) => {
      const running = spawn.startGit(args, options)
      startedGitProcesses.push(running)
      return running
    }
  }
})

let repoPath: string

beforeAll(() => {
  repoPath = makeBigRepo(4000)
}, 60_000)

afterAll(() => {
  removeRepoDir(repoPath)
})

describe('log continuation scope', () => {
  it('terminates a retained paging process when its managed runtime is disposed', async () => {
    const runtime = ManagedRuntime.make(LogContinuationsLive)
    const registry = await runtime.runPromise(LogContinuations)

    const firstPage = await registry.loadPage(repoPath, 0, 1, new AbortController().signal)
    expect(firstPage.commits.map((commit) => commit.message)).toEqual(['c4000'])
    expect(firstPage.hasMore).toBe(true)

    expect(startedGitProcesses).toHaveLength(1)
    const pagingPid = startedGitProcesses[0].child.pid
    expect(processAlive(pagingPid)).toBe(true)

    const secondPage = await registry.loadPage(repoPath, 1, 1, new AbortController().signal)
    expect(secondPage.commits.map((commit) => commit.message)).toEqual(['c3999'])
    expect(secondPage.hasMore).toBe(true)
    expect(startedGitProcesses).toHaveLength(1)
    expect(processAlive(pagingPid)).toBe(true)

    await runtime.dispose()

    await waitUntil(() => !processAlive(pagingPid), 10_000, 'paging git process exit')
    expect(processAlive(pagingPid)).toBe(false)
  }, 60_000)
})

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeRepo, commit, fetchRepo, openRepo, stageFile } from '../../operations/index'
import {
  createHangingGit,
  type HangingGit,
  killIfAlive,
  processAlive,
  waitUntil
} from '../../test-support/hanging-git'
import { removeRepoDir } from '../../test-support/repo-fixtures'
import { runOp } from '../../test-support/run-op'
import { repoLockCount } from '../lock'

let baseDir: string
let repoDir: string
let remoteDir: string

function gitIn(dir: string, ...args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' })
}

function write(name: string, contents: string): void {
  fs.writeFileSync(path.join(repoDir, name), contents)
}

beforeAll(async () => {
  baseDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-fetch-test-')))
  remoteDir = path.join(baseDir, 'remote.git')
  repoDir = path.join(baseDir, 'repo')
  execFileSync('git', ['init', '--bare', '-b', 'main', remoteDir])

  fs.mkdirSync(repoDir)
  execFileSync('git', ['-C', repoDir, 'init', '-b', 'main'])
  gitIn(repoDir, 'config', 'user.email', 'test@example.com')
  gitIn(repoDir, 'config', 'user.name', 'Test')
  gitIn(repoDir, 'remote', 'add', 'origin', remoteDir)
  write('tracked.txt', 'base\n')
  gitIn(repoDir, 'add', '.')
  gitIn(repoDir, 'commit', '-m', 'base')
  gitIn(repoDir, 'push', '-u', 'origin', 'main')

  await runOp(openRepo(repoDir))
})

afterAll(async () => {
  await runOp(closeRepo(repoDir))
  // Closing kills the session's commit-graph write mid-flight, and Windows keeps a killed process's
  // files undeletable for a moment after it exits — long enough to outlast every retry.
  removeRepoDir(baseDir)
})

describe('fetch does not serialize behind the repo lock', () => {
  it('fetches against a local remote without taking the repo lock', async () => {
    expect(repoLockCount()).toBe(0)
    await runOp(fetchRepo(repoDir))
    expect(repoLockCount()).toBe(0)
  })

  it('lets a concurrent mutation acquire the lock during an in-flight fetch', async () => {
    write('tracked.txt', 'fetch-concurrent\n')

    const fetching = runOp(fetchRepo(repoDir))
    await runOp(stageFile(repoDir, 'tracked.txt'))
    await runOp(commit(repoDir, 'commit during fetch'))

    await fetching

    gitIn(repoDir, 'reset', '--hard', 'HEAD~1')
  })
})

describe('closing a repo terminates an in-flight fetch', () => {
  let hangingFetch: HangingGit

  beforeAll(() => {
    hangingFetch = createHangingGit('rebase-fetch-hang-')
    gitIn(hangingFetch.repoDir, 'remote', 'add', 'origin', hangingFetch.remoteDir)
    gitIn(hangingFetch.repoDir, 'config', 'remote.origin.uploadpack', hangingFetch.uploadPack)
  })

  afterAll(() => {
    killIfAlive(hangingFetch.childPid())
    hangingFetch.cleanup()
  })

  it('settles the fetch promptly and leaves no transport child when the repo is closed mid-fetch', async () => {
    await runOp(openRepo(hangingFetch.repoDir))

    const fetching = runOp(fetchRepo(hangingFetch.repoDir)).then(
      () => 'resolved',
      () => 'rejected'
    )

    await waitUntil(() => hangingFetch.childPid() !== undefined, 10_000, 'transport child start')
    const transportChild = hangingFetch.childPid()
    expect(processAlive(transportChild)).toBe(true)

    const startedAt = Date.now()
    await runOp(closeRepo(hangingFetch.repoDir))
    const settled = await fetching
    const elapsedMs = Date.now() - startedAt

    expect(settled).toBe('rejected')
    expect(elapsedMs).toBeLessThan(5000)

    await waitUntil(() => !processAlive(transportChild), 10_000, 'transport child exit')
    expect(processAlive(transportChild)).toBe(false)
  }, 30_000)
})

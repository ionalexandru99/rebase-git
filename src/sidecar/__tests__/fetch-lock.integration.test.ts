import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeRepo, commit, fetchRepo, openRepo, stageFile } from '../operations'
import { repoLockCount } from '../repo-lock'
import { runOp } from './run-op'

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
  fs.rmSync(baseDir, { recursive: true, force: true })
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
  let hangBaseDir: string
  let hangRepoDir: string

  beforeAll(async () => {
    hangBaseDir = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-fetch-hang-'))
    )
    hangRepoDir = path.join(hangBaseDir, 'repo')
    fs.mkdirSync(hangRepoDir)
    execFileSync('git', ['-C', hangRepoDir, 'init', '-b', 'main'])
    gitIn(hangRepoDir, 'config', 'user.email', 'test@example.com')
    gitIn(hangRepoDir, 'config', 'user.name', 'Test')
    fs.writeFileSync(path.join(hangRepoDir, 'tracked.txt'), 'base\n')
    gitIn(hangRepoDir, 'add', '.')
    gitIn(hangRepoDir, 'commit', '-m', 'base')
    // `ext::sleep 30` makes `git fetch` block on a transport child that never speaks the protocol,
    // and `protocol.ext.allow=always` lets the sidecar's plain `git fetch` use it.
    gitIn(hangRepoDir, 'remote', 'add', 'origin', 'ext::sleep 30')
    gitIn(hangRepoDir, 'config', 'protocol.ext.allow', 'always')
  })

  afterAll(() => {
    fs.rmSync(hangBaseDir, { recursive: true, force: true })
  })

  function transportChildCount(): number {
    const listing = execFileSync('ps', ['-A', '-o', 'command='], { encoding: 'utf8' })
    return listing
      .split('\n')
      .filter(
        (line) =>
          (line.includes('git remote-ext origin sleep 30') || line.includes('/bin/sleep 30')) &&
          !line.includes('node') &&
          !line.includes('vitest')
      ).length
  }

  it('settles the fetch promptly and leaves no transport child when the repo is closed mid-fetch', async () => {
    await runOp(openRepo(hangRepoDir))

    const fetching = runOp(fetchRepo(hangRepoDir)).then(
      () => 'resolved',
      () => 'rejected'
    )

    await new Promise((resolve) => setTimeout(resolve, 1000))
    expect(transportChildCount()).toBeGreaterThan(0)

    const startedAt = Date.now()
    await runOp(closeRepo(hangRepoDir))
    const settled = await fetching
    const elapsedMs = Date.now() - startedAt

    expect(settled).toBe('rejected')
    expect(elapsedMs).toBeLessThan(5000)

    await new Promise((resolve) => setTimeout(resolve, 1000))
    expect(transportChildCount()).toBe(0)
  })
})

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeRepo, commit, fetchRepo, openRepo, stageFile } from '../operations'
import { repoLockCount } from '../repo-lock'

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

  await Effect.runPromise(openRepo(repoDir))
})

afterAll(async () => {
  await Effect.runPromise(closeRepo(repoDir))
  fs.rmSync(baseDir, { recursive: true, force: true })
})

describe('fetch does not serialize behind the repo lock', () => {
  it('fetches against a local remote without taking the repo lock', async () => {
    expect(repoLockCount()).toBe(0)
    await Effect.runPromise(fetchRepo(repoDir))
    expect(repoLockCount()).toBe(0)
  })

  it('lets a concurrent mutation acquire the lock during an in-flight fetch', async () => {
    write('tracked.txt', 'fetch-concurrent\n')

    const fetching = Effect.runPromise(fetchRepo(repoDir))
    await Effect.runPromise(stageFile(repoDir, 'tracked.txt'))
    await Effect.runPromise(commit(repoDir, 'commit during fetch'))

    await fetching

    gitIn(repoDir, 'reset', '--hard', 'HEAD~1')
  })
})

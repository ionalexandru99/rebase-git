import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fetchSemaphoreFor } from '../fetch-semaphore'
import { normalizeRepoPath } from '../git/instances'
import { closeRepo, openRepo } from '../operations'
import { repoLockCount, withRepoLock } from '../repo-lock'

let baseDir: string
let repoDir: string

beforeAll(() => {
  baseDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-reclaim-test-')))
  repoDir = path.join(baseDir, 'repo')
  fs.mkdirSync(repoDir)
  execFileSync('git', ['-C', repoDir, 'init', '-b', 'main'])
  execFileSync('git', ['-C', repoDir, 'config', 'user.email', 'test@example.com'])
  execFileSync('git', ['-C', repoDir, 'config', 'user.name', 'Test'])
  fs.writeFileSync(path.join(repoDir, 'tracked.txt'), 'base\n')
  execFileSync('git', ['-C', repoDir, 'add', '.'])
  execFileSync('git', ['-C', repoDir, 'commit', '-m', 'base'])
})

afterAll(() => {
  fs.rmSync(baseDir, { recursive: true, force: true })
})

describe('repo session reclaims its per-repo semaphore entries on close', () => {
  it('hands a fresh fetch semaphore after close and reopen', async () => {
    const key = normalizeRepoPath(repoDir)

    await Effect.runPromise(openRepo(repoDir))
    const before = fetchSemaphoreFor(key)

    await Effect.runPromise(closeRepo(repoDir))

    await Effect.runPromise(openRepo(repoDir))
    const after = fetchSemaphoreFor(key)

    expect(after).not.toBe(before)

    await Effect.runPromise(closeRepo(repoDir))
  })

  it('leaves the repo lock immediately re-acquirable and still serializing after close/reopen', async () => {
    const key = normalizeRepoPath(repoDir)

    await Effect.runPromise(openRepo(repoDir))
    await Effect.runPromise(closeRepo(repoDir))

    expect(repoLockCount()).toBe(0)

    await Effect.runPromise(openRepo(repoDir))

    const order: string[] = []
    await Effect.runPromise(
      Effect.all(
        [
          withRepoLock(
            key,
            Effect.gen(function* () {
              order.push('first:start')
              yield* Effect.sleep('10 millis')
              order.push('first:end')
            })
          ),
          withRepoLock(
            key,
            Effect.sync(() => {
              order.push('second:start')
              order.push('second:end')
            })
          )
        ],
        { concurrency: 'unbounded' }
      )
    )

    expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end'])
    expect(repoLockCount()).toBe(0)

    await Effect.runPromise(closeRepo(repoDir))
  })
})

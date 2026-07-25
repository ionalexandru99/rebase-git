import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { normalizeRepoPath } from '../../git/instances'
import { closeRepo, openRepo } from '../../operations/index'
import { runOp } from '../../test-support/run-op'
import { fetchSemaphoreFor } from '../fetch-semaphore'
import { repoLockCount, withRepoLock } from '../lock'

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

    await runOp(openRepo(repoDir))
    const before = fetchSemaphoreFor(key)

    await runOp(closeRepo(repoDir))

    await runOp(openRepo(repoDir))
    const after = fetchSemaphoreFor(key)

    expect(after).not.toBe(before)

    await runOp(closeRepo(repoDir))
  })

  it('reuses an active fetch semaphore across close and reopen', async () => {
    const key = normalizeRepoPath(repoDir)
    await runOp(openRepo(repoDir))
    const before = fetchSemaphoreFor(key)
    let releaseWork: (() => void) | undefined
    let startedResolve: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      startedResolve = resolve
    })
    const held = before.withPermits(
      () =>
        new Promise<void>((resolve) => {
          releaseWork = resolve
          startedResolve?.()
        })
    )
    await started

    await runOp(closeRepo(repoDir))
    await runOp(openRepo(repoDir))
    const after = fetchSemaphoreFor(key)

    expect(after).toBe(before)
    releaseWork?.()
    await held
    await runOp(closeRepo(repoDir))
  })

  it('leaves the repo lock immediately re-acquirable and still serializing after close/reopen', async () => {
    const key = normalizeRepoPath(repoDir)

    await runOp(openRepo(repoDir))
    await runOp(closeRepo(repoDir))

    expect(repoLockCount()).toBe(0)

    await runOp(openRepo(repoDir))

    const order: string[] = []
    await runOp(
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

    await runOp(closeRepo(repoDir))
  })
})

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { RpcTest } from '@effect/rpc'
import { HunkNotFound } from '@shared/git-rpc-errors'
import { SidecarRpcs } from '@shared/rpc'
import { Effect, Either } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeRepo, getStatus, openRepo } from '../operations'
import { handlersLayer } from '../rpc-handlers'

let repoDir: string

function git(...args: string[]): string {
  return execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8' })
}

function write(name: string, contents: string): void {
  fs.writeFileSync(path.join(repoDir, name), contents)
}

const stageFileThroughGroup = (payload: { repoPath: string; file: string }) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SidecarRpcs)
      return yield* Effect.either(client.stageFile(payload))
    }).pipe(Effect.scoped, Effect.provide(handlersLayer))
  )

const stageHunkThroughGroup = (payload: { repoPath: string; file: string; hunkHeader: string }) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SidecarRpcs)
      return yield* Effect.either(client.stageHunk(payload))
    }).pipe(Effect.scoped, Effect.provide(handlersLayer))
  )

beforeAll(async () => {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-rpc-stage-')))
  repoDir = path.join(base, 'repo')
  fs.mkdirSync(repoDir)
  execFileSync('git', ['-C', repoDir, 'init', '-b', 'main'])
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  write('tracked.txt', 'base\n')
  git('add', '.')
  git('commit', '-m', 'base')

  await Effect.runPromise(openRepo(repoDir))
})

afterAll(async () => {
  await Effect.runPromise(closeRepo(repoDir))
  fs.rmSync(path.dirname(repoDir), { recursive: true, force: true })
})

describe('staging through the RPC group against a real repo', () => {
  it('stages a new file and surfaces a void Ok success', async () => {
    write('new.txt', 'fresh\n')
    const result = await stageFileThroughGroup({ repoPath: repoDir, file: 'new.txt' })
    expect(Either.isRight(result)).toBe(true)

    const status = await Effect.runPromise(getStatus(repoDir))
    expect(status.status.staged).toContain('new.txt')
  })

  it('returns a typed HunkNotFound when the hunk header matches nothing', async () => {
    write('tracked.txt', 'changed\n')
    const result = await stageHunkThroughGroup({
      repoPath: repoDir,
      file: 'tracked.txt',
      hunkHeader: '@@ -999,1 +999,1 @@ no such hunk'
    })
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(HunkNotFound)
    }
  })
})

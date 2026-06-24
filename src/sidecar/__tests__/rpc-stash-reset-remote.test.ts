import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { RpcTest } from '@effect/rpc'
import { Conflict, FetchSkipped, GitError, RepoNotOpen } from '@shared/git-rpc-errors'
import {
  Fetch,
  Pull,
  Push,
  Reset,
  SidecarRpcs,
  StashApply,
  StashDrop,
  StashPop,
  StashPush
} from '@shared/rpc'
import { Effect, Either, Schema } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fetchSemaphoreFor } from '../fetch-semaphore'
import { closeRepo, openRepo } from '../operations'
import { handlersLayer } from '../rpc-handlers'

const decode = <A, I>(schema: Schema.Schema<A, I>, value: unknown) =>
  Schema.decodeUnknownEither(schema)(value)

let repoDir: string

function git(...args: string[]): string {
  return execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8' })
}

function writeFile(name: string, contents: string): void {
  fs.writeFileSync(path.join(repoDir, name), contents)
}

function commitFile(name: string, contents: string, message: string): void {
  writeFile(name, contents)
  git('add', '.')
  git('commit', '-m', message)
}

function headSha(): string {
  return git('rev-parse', 'HEAD').trim()
}

const resetThroughGroup = (payload: {
  repoPath: string
  sha: string
  mode: 'soft' | 'mixed' | 'hard'
}) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SidecarRpcs)
      return yield* Effect.either(client.reset(payload))
    }).pipe(Effect.scoped, Effect.provide(handlersLayer))
  )

const stashPushThroughGroup = (payload: {
  repoPath: string
  message?: string
  includeUntracked?: boolean
  files?: readonly string[]
}) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SidecarRpcs)
      return yield* Effect.either(client.stashPush(payload))
    }).pipe(Effect.scoped, Effect.provide(handlersLayer))
  )

const stashApplyThroughGroup = (payload: { repoPath: string; index: number }) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SidecarRpcs)
      return yield* Effect.either(client.stashApply(payload))
    }).pipe(Effect.scoped, Effect.provide(handlersLayer))
  )

const stashPopThroughGroup = (payload: { repoPath: string; index: number }) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SidecarRpcs)
      return yield* Effect.either(client.stashPop(payload))
    }).pipe(Effect.scoped, Effect.provide(handlersLayer))
  )

const stashDropThroughGroup = (payload: { repoPath: string; index: number }) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SidecarRpcs)
      return yield* Effect.either(client.stashDrop(payload))
    }).pipe(Effect.scoped, Effect.provide(handlersLayer))
  )

const fetchThroughGroup = (payload: { repoPath: string }) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SidecarRpcs)
      return yield* Effect.either(client.fetch(payload))
    }).pipe(Effect.scoped, Effect.provide(handlersLayer))
  )

const pushThroughGroup = (payload: { repoPath: string }) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SidecarRpcs)
      return yield* Effect.either(client.push(payload))
    }).pipe(Effect.scoped, Effect.provide(handlersLayer))
  )

const pullThroughGroup = (payload: { repoPath: string }) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SidecarRpcs)
      return yield* Effect.either(client.pull(payload))
    }).pipe(Effect.scoped, Effect.provide(handlersLayer))
  )

beforeAll(async () => {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-rpc-srr-')))
  repoDir = path.join(base, 'repo')
  fs.mkdirSync(repoDir)
  execFileSync('git', ['-C', repoDir, 'init', '-b', 'main'])
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  commitFile('file.txt', 'base\n', 'base')

  await Effect.runPromise(openRepo(repoDir))
})

afterAll(async () => {
  await Effect.runPromise(closeRepo(repoDir))
  fs.rmSync(path.dirname(repoDir), { recursive: true, force: true })
})

describe('stash / reset / remote RPC payload schemas', () => {
  it('accepts a well-formed reset payload and rejects a missing sha or invalid mode', () => {
    const schema = Reset.payloadSchema
    expect(Either.isRight(decode(schema, { repoPath: '/repo', sha: 'abc123', mode: 'hard' }))).toBe(
      true
    )
    expect(Either.isLeft(decode(schema, { repoPath: '/repo', mode: 'hard' }))).toBe(true)
    expect(Either.isLeft(decode(schema, { repoPath: '/repo', sha: 'abc123', mode: 'wipe' }))).toBe(
      true
    )
  })

  it('accepts a stashPush payload with and without optional fields', () => {
    const schema = StashPush.payloadSchema
    expect(Either.isRight(decode(schema, { repoPath: '/repo' }))).toBe(true)
    expect(
      Either.isRight(
        decode(schema, {
          repoPath: '/repo',
          message: 'wip',
          includeUntracked: true,
          files: ['a.txt']
        })
      )
    ).toBe(true)
    expect(Either.isLeft(decode(schema, {}))).toBe(true)
  })

  it('accepts a stash index payload and rejects a missing or non-numeric index', () => {
    for (const schema of [
      StashApply.payloadSchema,
      StashPop.payloadSchema,
      StashDrop.payloadSchema
    ]) {
      expect(Either.isRight(decode(schema, { repoPath: '/repo', index: 0 }))).toBe(true)
      expect(Either.isLeft(decode(schema, { repoPath: '/repo' }))).toBe(true)
      expect(Either.isLeft(decode(schema, { repoPath: '/repo', index: 'x' }))).toBe(true)
    }
  })

  it('accepts a repo-only payload for fetch, push and pull', () => {
    for (const schema of [Fetch.payloadSchema, Push.payloadSchema, Pull.payloadSchema]) {
      expect(Either.isRight(decode(schema, { repoPath: '/repo' }))).toBe(true)
      expect(Either.isLeft(decode(schema, {}))).toBe(true)
    }
  })
})

describe('reset RPC handler', () => {
  it('fails with a typed GitError when the repo path does not resolve', async () => {
    const result = await resetThroughGroup({
      repoPath: '/no/such/path/here',
      sha: 'HEAD',
      mode: 'mixed'
    })
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(GitError)
      expect((result.left as GitError).message).toBe('invalid repository path')
    }
  })

  it('fails with a typed RepoNotOpen when the repo resolves but was never opened', async () => {
    const unopened = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-rpc-srr-reset-unopened-'))
    )
    execFileSync('git', ['-C', unopened, 'init', '-b', 'main'])
    try {
      const result = await resetThroughGroup({ repoPath: unopened, sha: 'HEAD', mode: 'mixed' })
      expect(Either.isLeft(result)).toBe(true)
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(RepoNotOpen)
      }
    } finally {
      fs.rmSync(unopened, { recursive: true, force: true })
    }
  })

  it('soft-resets to a target commit and returns a void Ok success', async () => {
    git('checkout', 'main')
    const before = headSha()
    commitFile('reset-me.txt', 'temp\n', 'commit to be reset away')

    const result = await resetThroughGroup({ repoPath: repoDir, sha: before, mode: 'soft' })
    expect(Either.isRight(result)).toBe(true)
    expect(headSha()).toBe(before)
    git('reset', '--hard', before)
  })
})

describe('stashPush / stashApply / stashPop / stashDrop RPC handlers', () => {
  it('pushes a stash from tracked changes and returns a void Ok success', async () => {
    git('checkout', 'main')
    commitFile('stash-target.txt', 'one\n', 'add stash target')
    writeFile('stash-target.txt', 'two\n')

    const result = await stashPushThroughGroup({ repoPath: repoDir, message: 'wip' })
    expect(Either.isRight(result)).toBe(true)
    expect(git('stash', 'list').trim()).toContain('wip')
    git('stash', 'drop')
  })

  it('drops a stash entry by index and returns a void Ok success', async () => {
    git('checkout', 'main')
    commitFile('drop-target.txt', 'one\n', 'add drop target')
    writeFile('drop-target.txt', 'two\n')
    git('stash', 'push', '-m', 'doomed')

    const result = await stashDropThroughGroup({ repoPath: repoDir, index: 0 })
    expect(Either.isRight(result)).toBe(true)
    expect(git('stash', 'list').trim()).toBe('')
    git('checkout', '--', 'drop-target.txt')
  })

  it('applies a clean stash and returns a void Ok success', async () => {
    git('checkout', 'main')
    commitFile('apply-target.txt', 'one\n', 'add apply target')
    writeFile('apply-target.txt', 'two\n')
    git('stash', 'push', '-m', 'to-apply')

    const result = await stashApplyThroughGroup({ repoPath: repoDir, index: 0 })
    expect(Either.isRight(result)).toBe(true)
    expect(fs.readFileSync(path.join(repoDir, 'apply-target.txt'), 'utf8')).toBe('two\n')
    git('checkout', '--', 'apply-target.txt')
    git('stash', 'drop')
  })

  it('pops a clean stash and returns a void Ok success', async () => {
    git('checkout', 'main')
    commitFile('pop-target.txt', 'one\n', 'add pop target')
    writeFile('pop-target.txt', 'two\n')
    git('stash', 'push', '-m', 'to-pop')

    const result = await stashPopThroughGroup({ repoPath: repoDir, index: 0 })
    expect(Either.isRight(result)).toBe(true)
    expect(fs.readFileSync(path.join(repoDir, 'pop-target.txt'), 'utf8')).toBe('two\n')
    expect(git('stash', 'list').trim()).toBe('')
    git('checkout', '--', 'pop-target.txt')
  })

  it('surfaces a typed Conflict when a stash pop cannot apply cleanly', async () => {
    git('checkout', 'main')
    commitFile('stash-conflict.txt', 'base\n', 'base for stash conflict')
    writeFile('stash-conflict.txt', 'stashed\n')
    git('stash', 'push', '-m', 'conflicting')
    commitFile('stash-conflict.txt', 'committed\n', 'diverge from stash')

    const result = await stashPopThroughGroup({ repoPath: repoDir, index: 0 })
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(Conflict)
    }
    git('reset', '--hard', 'HEAD')
    git('stash', 'drop')
  })
})

describe('fetch / push / pull RPC handlers', () => {
  it('fails with a typed RepoNotOpen when the repo was never opened', async () => {
    const unopened = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-rpc-srr-remote-unopened-'))
    )
    execFileSync('git', ['-C', unopened, 'init', '-b', 'main'])
    try {
      for (const call of [fetchThroughGroup, pushThroughGroup, pullThroughGroup]) {
        const result = await call({ repoPath: unopened })
        expect(Either.isLeft(result)).toBe(true)
        if (Either.isLeft(result)) {
          expect(result.left).toBeInstanceOf(RepoNotOpen)
        }
      }
    } finally {
      fs.rmSync(unopened, { recursive: true, force: true })
    }
  })

  it('surfaces a typed GitError from push when no remote is configured', async () => {
    git('checkout', 'main')
    const result = await pushThroughGroup({ repoPath: repoDir })
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(GitError)
    }
  })

  it('surfaces a typed FetchSkipped when the fetch semaphore is already held', async () => {
    const key = fs.realpathSync.native(repoDir)
    const semaphore = fetchSemaphoreFor(key)
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const occupy = semaphore.withPermits(() => held)
    try {
      const result = await fetchThroughGroup({ repoPath: repoDir })
      expect(Either.isLeft(result)).toBe(true)
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(FetchSkipped)
      }
    } finally {
      release()
      await occupy
    }
  })
})

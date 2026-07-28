import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { RpcTest } from '@effect/rpc'
import { GitError, NotARepo } from '@shared/git-rpc-errors'
import { CloseRepo, OpenRepo, ScanForRepos, SidecarRpcs } from '@shared/rpc'
import { Effect, Either, Schema } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeRepo } from '../../operations/index'
import { runOp } from '../../test-support/run-op'
import { handlersLayer } from '../handlers'

const decode = <A, I>(schema: Schema.Schema<A, I>, value: unknown) =>
  Schema.decodeUnknownEither(schema)(value)

let homeScanDir: string
let repoDir: string
let nonRepoDir: string

function git(dir: string, ...args: string[]): void {
  execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' })
}

const openThroughGroup = (payload: { repoPath: string }) =>
  runOp(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SidecarRpcs)
      return yield* Effect.either(client.openRepo(payload))
    }).pipe(Effect.scoped, Effect.provide(handlersLayer))
  )

const closeThroughGroup = (payload: { repoPath: string }) =>
  runOp(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SidecarRpcs)
      return yield* Effect.either(client.closeRepo(payload))
    }).pipe(Effect.scoped, Effect.provide(handlersLayer))
  )

const scanThroughGroup = (payload: { dirPath: string }) =>
  runOp(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SidecarRpcs)
      return yield* Effect.either(client.scanForRepos(payload))
    }).pipe(Effect.scoped, Effect.provide(handlersLayer))
  )

beforeAll(() => {
  homeScanDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.homedir(), '.rebase-rpc-ocs-')))
  repoDir = path.join(homeScanDir, 'repo')
  fs.mkdirSync(repoDir)
  git(repoDir, 'init', '-b', 'main')
  git(repoDir, 'config', 'user.email', 'test@example.com')
  git(repoDir, 'config', 'user.name', 'Test')
  fs.writeFileSync(path.join(repoDir, 'README.md'), '# test\n')
  git(repoDir, 'add', '.')
  git(repoDir, 'commit', '-m', 'initial')

  nonRepoDir = path.join(homeScanDir, 'plain')
  fs.mkdirSync(nonRepoDir)
})

afterAll(async () => {
  await runOp(closeRepo(repoDir))
  fs.rmSync(homeScanDir, { recursive: true, force: true })
})

describe('open / close / scan RPC payload schemas', () => {
  it('accepts a repo-only payload for open and close, rejecting a missing repoPath', () => {
    for (const schema of [OpenRepo.payloadSchema, CloseRepo.payloadSchema]) {
      expect(Either.isRight(decode(schema, { repoPath: '/repo' }))).toBe(true)
      expect(Either.isLeft(decode(schema, {}))).toBe(true)
    }
  })

  it('accepts a dirPath payload for scan and rejects a missing dirPath', () => {
    expect(Either.isRight(decode(ScanForRepos.payloadSchema, { dirPath: '/home/x' }))).toBe(true)
    expect(Either.isLeft(decode(ScanForRepos.payloadSchema, {}))).toBe(true)
  })
})

describe('openRepo RPC handler', () => {
  it('opens a real repo and returns the open result on the Ok channel', async () => {
    const result = await openThroughGroup({ repoPath: repoDir })
    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect(result.right.result.path).toBe(fs.realpathSync.native(repoDir))
      expect(result.right.result.remotes).toEqual({})
    }
  })

  it('surfaces a typed NotARepo when the directory exists but is not a git repo', async () => {
    const result = await openThroughGroup({ repoPath: nonRepoDir })
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(NotARepo)
    }
  })

  it('fails with a typed GitError when the path does not exist', async () => {
    const result = await openThroughGroup({ repoPath: path.join(homeScanDir, 'no-such-dir') })
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(GitError)
    }
  })
})

describe('closeRepo RPC handler', () => {
  it('closes an open repo and returns a void Ok success', async () => {
    await openThroughGroup({ repoPath: repoDir })
    const result = await closeThroughGroup({ repoPath: repoDir })
    expect(Either.isRight(result)).toBe(true)
  })

  it('idempotently succeeds for a repo that was never opened', async () => {
    const result = await closeThroughGroup({ repoPath: repoDir })
    expect(Either.isRight(result)).toBe(true)
  })

  it('idempotently succeeds for a path that does not resolve', async () => {
    const result = await closeThroughGroup({ repoPath: path.join(homeScanDir, 'no-such-dir') })
    expect(Either.isRight(result)).toBe(true)
  })
})

describe('scanForRepos RPC handler', () => {
  it('scans a valid directory inside home and returns its nested git repos', async () => {
    const result = await scanThroughGroup({ dirPath: homeScanDir })
    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect([...result.right.repos]).toEqual([repoDir])
    }
  })

  // A clone in flight keeps a real working tree in its staging directory next to the destination;
  // the scan must not offer a repository that is still being written.
  it('leaves a clone staging directory out of the listing', async () => {
    const staging = path.join(homeScanDir, '.stalled.rebase-clone-ab12cd34')
    fs.mkdirSync(staging)
    git(staging, 'init', '-b', 'main')

    const result = await scanThroughGroup({ dirPath: homeScanDir })

    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect([...result.right.repos]).toEqual([repoDir])
    }
    fs.rmSync(staging, { recursive: true, force: true })
  })

  it('fails with a typed GitError for a non-absolute directory path', async () => {
    const result = await scanThroughGroup({ dirPath: 'relative/dir' })
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(GitError)
      expect((result.left as GitError).message).toBe('invalid directory path')
    }
  })

  it('fails with a typed GitError for a path containing a parent traversal segment', async () => {
    const result = await scanThroughGroup({ dirPath: `${homeScanDir}/../..${path.sep}etc` })
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(GitError)
      expect((result.left as GitError).message).toBe('invalid directory path')
    }
  })

  it('fails with a typed GitError for a directory outside the user home tree', async () => {
    const result = await scanThroughGroup({ dirPath: path.parse(os.homedir()).root })
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(GitError)
      expect((result.left as GitError).message).toBe('invalid directory path')
    }
  })
})

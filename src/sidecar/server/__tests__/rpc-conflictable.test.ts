import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { RpcTest } from '@effect/rpc'
import { Conflict, GitError, RepoNotOpen } from '@shared/git-rpc-errors'
import { CherryPick, MergeBranch, RevertCommit, SidecarRpcs } from '@shared/rpc'
import { Effect, Either, Schema } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeRepo, openRepo } from '../../operations/index'
import { runOp } from '../../test-support/run-op'
import { handlersLayer } from '../handlers'

const decode = <A, I>(schema: Schema.Schema<A, I>, value: unknown) =>
  Schema.decodeUnknownEither(schema)(value)

let repoDir: string

function git(...args: string[]): string {
  return execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8' })
}

function commitFile(name: string, contents: string, message: string): void {
  fs.writeFileSync(path.join(repoDir, name), contents)
  git('add', '.')
  git('commit', '-m', message)
}

function headSha(): string {
  return git('rev-parse', 'HEAD').trim()
}

const revertThroughGroup = (payload: { repoPath: string; sha: string }) =>
  runOp(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SidecarRpcs)
      return yield* Effect.either(client.revertCommit(payload))
    }).pipe(Effect.scoped, Effect.provide(handlersLayer))
  )

const cherryPickThroughGroup = (payload: { repoPath: string; sha: string }) =>
  runOp(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SidecarRpcs)
      return yield* Effect.either(client.cherryPick(payload))
    }).pipe(Effect.scoped, Effect.provide(handlersLayer))
  )

const mergeThroughGroup = (payload: {
  repoPath: string
  refKind: 'local' | 'remote' | 'tag'
  fullPath: string
}) =>
  runOp(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SidecarRpcs)
      return yield* Effect.either(client.mergeBranch(payload))
    }).pipe(Effect.scoped, Effect.provide(handlersLayer))
  )

beforeAll(async () => {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-rpc-conf-')))
  repoDir = path.join(base, 'repo')
  fs.mkdirSync(repoDir)
  execFileSync('git', ['-C', repoDir, 'init', '-b', 'main'])
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  commitFile('file.txt', 'base\n', 'base')

  await runOp(openRepo(repoDir))
})

afterAll(async () => {
  await runOp(closeRepo(repoDir))
  fs.rmSync(path.dirname(repoDir), { recursive: true, force: true })
})

describe('conflictable RPC payload schemas', () => {
  it('accepts a well-formed sha payload and rejects a missing or blank sha', () => {
    for (const schema of [RevertCommit.payloadSchema, CherryPick.payloadSchema]) {
      expect(Either.isRight(decode(schema, { repoPath: '/repo', sha: 'abc123' }))).toBe(true)
      expect(Either.isLeft(decode(schema, { repoPath: '/repo' }))).toBe(true)
      expect(Either.isLeft(decode(schema, { repoPath: '/repo', sha: '   ' }))).toBe(true)
    }
  })

  it('accepts a well-formed ref payload and rejects missing identity or a blank path', () => {
    const schema = MergeBranch.payloadSchema
    expect(
      Either.isRight(decode(schema, { repoPath: '/repo', refKind: 'local', fullPath: 'feature' }))
    ).toBe(true)
    expect(Either.isLeft(decode(schema, { repoPath: '/repo' }))).toBe(true)
    expect(
      Either.isLeft(decode(schema, { repoPath: '/repo', refKind: 'local', fullPath: '   ' }))
    ).toBe(true)
  })
})

describe('revertCommit RPC handler', () => {
  it('fails with a typed GitError when the repo path does not resolve', async () => {
    const result = await revertThroughGroup({ repoPath: '/no/such/path/here', sha: 'HEAD' })
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(GitError)
      expect((result.left as GitError).message).toBe('invalid repository path')
    }
  })

  it('fails with a typed RepoNotOpen when the repo resolves but was never opened', async () => {
    const unopened = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-rpc-conf-unopened-'))
    )
    execFileSync('git', ['-C', unopened, 'init', '-b', 'main'])
    try {
      const result = await revertThroughGroup({ repoPath: unopened, sha: 'HEAD' })
      expect(Either.isLeft(result)).toBe(true)
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(RepoNotOpen)
      }
    } finally {
      fs.rmSync(unopened, { recursive: true, force: true })
    }
  })

  it('surfaces a typed Conflict when a revert leaves the tree conflicted', async () => {
    git('checkout', 'main')
    commitFile('conflict.txt', 'first\n', 'add conflict file')
    const target = headSha()
    commitFile('conflict.txt', 'second\n', 'change conflict file')

    const result = await revertThroughGroup({ repoPath: repoDir, sha: target })
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(Conflict)
    }
    git('revert', '--abort')
  })

  it('reverts a clean commit and returns a void Ok success', async () => {
    git('checkout', 'main')
    commitFile('revertable.txt', 'added\n', 'add a revertable file')
    const target = headSha()

    const result = await revertThroughGroup({ repoPath: repoDir, sha: target })
    expect(Either.isRight(result)).toBe(true)
    expect(fs.existsSync(path.join(repoDir, 'revertable.txt'))).toBe(false)
  })
})

describe('cherryPick RPC handler', () => {
  it('fails with a typed RepoNotOpen when the repo was never opened', async () => {
    const unopened = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-rpc-conf-cp-unopened-'))
    )
    execFileSync('git', ['-C', unopened, 'init', '-b', 'main'])
    try {
      const result = await cherryPickThroughGroup({ repoPath: unopened, sha: 'HEAD' })
      expect(Either.isLeft(result)).toBe(true)
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(RepoNotOpen)
      }
    } finally {
      fs.rmSync(unopened, { recursive: true, force: true })
    }
  })

  it('cherry-picks a clean commit and returns a void Ok success', async () => {
    git('checkout', 'main')
    git('checkout', '-b', 'pick/source')
    commitFile('pick.txt', 'picked\n', 'pick this commit')
    const source = headSha()
    git('checkout', 'main')

    const result = await cherryPickThroughGroup({ repoPath: repoDir, sha: source })
    expect(Either.isRight(result)).toBe(true)
    expect(fs.readFileSync(path.join(repoDir, 'pick.txt'), 'utf8')).toBe('picked\n')
  })

  it('surfaces a typed Conflict when a cherry-pick leaves the tree conflicted', async () => {
    git('checkout', 'main')
    commitFile('cp-conflict.txt', 'main-base\n', 'main base for cherry-pick conflict')
    git('checkout', '-b', 'pick/conflict')
    commitFile('cp-conflict.txt', 'branch-side\n', 'branch side of cherry-pick conflict')
    const source = headSha()
    git('checkout', 'main')
    commitFile('cp-conflict.txt', 'main-side\n', 'main side of cherry-pick conflict')

    const result = await cherryPickThroughGroup({ repoPath: repoDir, sha: source })
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(Conflict)
    }
    git('cherry-pick', '--abort')
  })
})

describe('mergeBranch RPC handler', () => {
  it('fails with a typed GitError when the repo path does not resolve', async () => {
    const result = await mergeThroughGroup({
      repoPath: '/no/such/path/here',
      refKind: 'local',
      fullPath: 'main'
    })
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(GitError)
    }
  })

  it('merges a branch cleanly and returns a void Ok success', async () => {
    git('checkout', 'main')
    git('checkout', '-b', 'merge/clean')
    commitFile('clean.txt', 'clean\n', 'add clean file')
    git('checkout', 'main')

    const result = await mergeThroughGroup({
      repoPath: repoDir,
      refKind: 'local',
      fullPath: 'merge/clean'
    })
    expect(Either.isRight(result)).toBe(true)
    expect(fs.existsSync(path.join(repoDir, 'clean.txt'))).toBe(true)
  })

  it('retries transient index.lock contention before merging', async () => {
    git('checkout', 'main')
    git('checkout', '-b', 'merge/retry')
    commitFile('retry.txt', 'retry\n', 'add retry file')
    git('checkout', 'main')
    const indexLock = path.join(repoDir, '.git', 'index.lock')
    fs.writeFileSync(indexLock, 'busy')
    const release = setTimeout(() => fs.rmSync(indexLock, { force: true }), 40)

    try {
      const result = await mergeThroughGroup({
        repoPath: repoDir,
        refKind: 'local',
        fullPath: 'merge/retry'
      })

      expect(Either.isRight(result)).toBe(true)
      expect(fs.existsSync(path.join(repoDir, 'retry.txt'))).toBe(true)
    } finally {
      clearTimeout(release)
      fs.rmSync(indexLock, { force: true })
    }
  })

  it('surfaces a typed Conflict when a merge leaves the tree conflicted', async () => {
    git('checkout', 'main')
    commitFile('merge-conflict.txt', 'main-base\n', 'main base for merge conflict')
    git('checkout', '-b', 'merge/conflict', 'HEAD~1')
    commitFile('merge-conflict.txt', 'branch-side\n', 'branch side of merge conflict')
    git('checkout', 'main')

    const result = await mergeThroughGroup({
      repoPath: repoDir,
      refKind: 'local',
      fullPath: 'merge/conflict'
    })
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(Conflict)
    }
    git('merge', '--abort')
  })
})

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { RpcTest } from '@effect/rpc'
import { GitError, RepoNotOpen } from '@shared/git-rpc-errors'
import {
  Checkout,
  CreateBranch,
  CreateTag,
  DeleteBranch,
  DeleteTag,
  RenameBranch,
  SidecarRpcs
} from '@shared/rpc'
import { Effect, Either, Schema } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeRepo, openRepo } from '../operations'
import { handlersLayer } from '../rpc-handlers'
import { runOp } from './run-op'

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

const createBranchThroughGroup = (payload: {
  repoPath: string
  name: string
  startPoint?: string
  checkout?: boolean
}) =>
  runOp(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SidecarRpcs)
      return yield* Effect.either(client.createBranch(payload))
    }).pipe(Effect.scoped, Effect.provide(handlersLayer))
  )

const deleteBranchThroughGroup = (payload: { repoPath: string; name: string; force?: boolean }) =>
  runOp(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SidecarRpcs)
      return yield* Effect.either(client.deleteBranch(payload))
    }).pipe(Effect.scoped, Effect.provide(handlersLayer))
  )

const renameBranchThroughGroup = (payload: {
  repoPath: string
  oldName: string
  newName: string
}) =>
  runOp(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SidecarRpcs)
      return yield* Effect.either(client.renameBranch(payload))
    }).pipe(Effect.scoped, Effect.provide(handlersLayer))
  )

const checkoutThroughGroup = (payload: {
  repoPath: string
  refKind: 'local' | 'remote' | 'tag'
  fullPath: string
}) =>
  runOp(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SidecarRpcs)
      return yield* Effect.either(client.checkout(payload))
    }).pipe(Effect.scoped, Effect.provide(handlersLayer))
  )

const createTagThroughGroup = (payload: {
  repoPath: string
  name: string
  ref?: string
  message?: string
}) =>
  runOp(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SidecarRpcs)
      return yield* Effect.either(client.createTag(payload))
    }).pipe(Effect.scoped, Effect.provide(handlersLayer))
  )

const deleteTagThroughGroup = (payload: { repoPath: string; name: string }) =>
  runOp(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SidecarRpcs)
      return yield* Effect.either(client.deleteTag(payload))
    }).pipe(Effect.scoped, Effect.provide(handlersLayer))
  )

beforeAll(async () => {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-rpc-reftag-')))
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

describe('branch & tag RPC payload schemas', () => {
  it('accepts a well-formed createBranch payload and rejects a missing or blank name', () => {
    const schema = CreateBranch.payloadSchema
    expect(Either.isRight(decode(schema, { repoPath: '/repo', name: 'feature' }))).toBe(true)
    expect(
      Either.isRight(
        decode(schema, { repoPath: '/repo', name: 'feature', startPoint: 'main', checkout: true })
      )
    ).toBe(true)
    expect(Either.isLeft(decode(schema, { repoPath: '/repo' }))).toBe(true)
    expect(Either.isLeft(decode(schema, { repoPath: '/repo', name: '   ' }))).toBe(true)
  })

  it('accepts a well-formed deleteBranch payload and rejects a missing name', () => {
    const schema = DeleteBranch.payloadSchema
    expect(Either.isRight(decode(schema, { repoPath: '/repo', name: 'feature' }))).toBe(true)
    expect(
      Either.isRight(decode(schema, { repoPath: '/repo', name: 'feature', force: true }))
    ).toBe(true)
    expect(Either.isLeft(decode(schema, { repoPath: '/repo' }))).toBe(true)
  })

  it('accepts a well-formed renameBranch payload and rejects a missing newName', () => {
    const schema = RenameBranch.payloadSchema
    expect(Either.isRight(decode(schema, { repoPath: '/repo', oldName: 'a', newName: 'b' }))).toBe(
      true
    )
    expect(Either.isLeft(decode(schema, { repoPath: '/repo', oldName: 'a' }))).toBe(true)
    expect(Either.isLeft(decode(schema, { repoPath: '/repo', oldName: 'a', newName: '  ' }))).toBe(
      true
    )
  })

  it('accepts a well-formed checkout payload and rejects an invalid refKind', () => {
    const schema = Checkout.payloadSchema
    expect(
      Either.isRight(decode(schema, { repoPath: '/repo', refKind: 'local', fullPath: 'main' }))
    ).toBe(true)
    expect(
      Either.isLeft(decode(schema, { repoPath: '/repo', refKind: 'branch', fullPath: 'main' }))
    ).toBe(true)
    expect(Either.isLeft(decode(schema, { repoPath: '/repo', refKind: 'local' }))).toBe(true)
  })

  it('accepts a well-formed createTag payload and rejects a missing name', () => {
    const schema = CreateTag.payloadSchema
    expect(Either.isRight(decode(schema, { repoPath: '/repo', name: 'v1' }))).toBe(true)
    expect(
      Either.isRight(decode(schema, { repoPath: '/repo', name: 'v1', ref: 'main', message: 'rel' }))
    ).toBe(true)
    expect(Either.isLeft(decode(schema, { repoPath: '/repo' }))).toBe(true)
  })

  it('accepts a well-formed deleteTag payload and rejects a missing name', () => {
    const schema = DeleteTag.payloadSchema
    expect(Either.isRight(decode(schema, { repoPath: '/repo', name: 'v1' }))).toBe(true)
    expect(Either.isLeft(decode(schema, { repoPath: '/repo' }))).toBe(true)
  })
})

describe('createBranch RPC handler', () => {
  it('fails with a typed GitError when the repo path does not resolve', async () => {
    const result = await createBranchThroughGroup({ repoPath: '/no/such/path', name: 'feature' })
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(GitError)
      expect((result.left as GitError).message).toBe('invalid repository path')
    }
  })

  it('fails with a typed RepoNotOpen when the repo resolves but was never opened', async () => {
    const unopened = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-rpc-reftag-unopened-'))
    )
    execFileSync('git', ['-C', unopened, 'init', '-b', 'main'])
    try {
      const result = await createBranchThroughGroup({ repoPath: unopened, name: 'feature' })
      expect(Either.isLeft(result)).toBe(true)
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(RepoNotOpen)
      }
    } finally {
      fs.rmSync(unopened, { recursive: true, force: true })
    }
  })

  it('creates a branch and returns a void Ok success', async () => {
    const result = await createBranchThroughGroup({ repoPath: repoDir, name: 'cb/new' })
    expect(Either.isRight(result)).toBe(true)
    expect(git('branch', '--list', 'cb/new').trim()).toContain('cb/new')
  })
})

describe('deleteBranch RPC handler', () => {
  it('deletes a branch and returns a void Ok success', async () => {
    git('branch', 'db/doomed')
    const result = await deleteBranchThroughGroup({
      repoPath: repoDir,
      name: 'db/doomed',
      force: true
    })
    expect(Either.isRight(result)).toBe(true)
    expect(git('branch', '--list', 'db/doomed').trim()).toBe('')
  })

  it('fails with a typed RepoNotOpen when the repo was never opened', async () => {
    const unopened = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-rpc-reftag-db-unopened-'))
    )
    execFileSync('git', ['-C', unopened, 'init', '-b', 'main'])
    try {
      const result = await deleteBranchThroughGroup({ repoPath: unopened, name: 'whatever' })
      expect(Either.isLeft(result)).toBe(true)
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(RepoNotOpen)
      }
    } finally {
      fs.rmSync(unopened, { recursive: true, force: true })
    }
  })
})

describe('renameBranch RPC handler', () => {
  it('renames a branch and returns a void Ok success', async () => {
    git('branch', 'rb/before')
    const result = await renameBranchThroughGroup({
      repoPath: repoDir,
      oldName: 'rb/before',
      newName: 'rb/after'
    })
    expect(Either.isRight(result)).toBe(true)
    expect(git('branch', '--list', 'rb/after').trim()).toContain('rb/after')
    expect(git('branch', '--list', 'rb/before').trim()).toBe('')
  })

  it('fails with a typed GitError when the source branch does not exist', async () => {
    const result = await renameBranchThroughGroup({
      repoPath: repoDir,
      oldName: 'rb/missing',
      newName: 'rb/other'
    })
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(GitError)
    }
  })
})

describe('checkout RPC handler', () => {
  it('checks out a local branch and returns the checked-out ref name', async () => {
    git('checkout', 'main')
    git('branch', 'co/target')
    const result = await checkoutThroughGroup({
      repoPath: repoDir,
      refKind: 'local',
      fullPath: 'co/target'
    })
    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect(result.right.checkedOut).toBe('co/target')
    }
    expect(git('rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('co/target')
    git('checkout', 'main')
  })

  it('fails with a typed GitError when the repo path does not resolve', async () => {
    const result = await checkoutThroughGroup({
      repoPath: '/no/such/path',
      refKind: 'local',
      fullPath: 'main'
    })
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(GitError)
    }
  })
})

describe('createTag RPC handler', () => {
  it('creates a tag and returns a void Ok success', async () => {
    git('checkout', 'main')
    const result = await createTagThroughGroup({ repoPath: repoDir, name: 'v-create' })
    expect(Either.isRight(result)).toBe(true)
    expect(git('tag', '--list', 'v-create').trim()).toBe('v-create')
  })

  it('fails with a typed RepoNotOpen when the repo was never opened', async () => {
    const unopened = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-rpc-reftag-tag-unopened-'))
    )
    execFileSync('git', ['-C', unopened, 'init', '-b', 'main'])
    try {
      const result = await createTagThroughGroup({ repoPath: unopened, name: 'v1' })
      expect(Either.isLeft(result)).toBe(true)
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(RepoNotOpen)
      }
    } finally {
      fs.rmSync(unopened, { recursive: true, force: true })
    }
  })
})

describe('deleteTag RPC handler', () => {
  it('deletes a tag and returns a void Ok success', async () => {
    git('checkout', 'main')
    git('tag', 'v-doomed')
    const result = await deleteTagThroughGroup({ repoPath: repoDir, name: 'v-doomed' })
    expect(Either.isRight(result)).toBe(true)
    expect(git('tag', '--list', 'v-doomed').trim()).toBe('')
  })
})

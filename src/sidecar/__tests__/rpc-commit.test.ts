import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { RpcTest } from '@effect/rpc'
import { GitError, RepoNotOpen } from '@shared/git-rpc-errors'
import { Commit, SidecarRpcs } from '@shared/rpc'
import { Effect, Either, Schema } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { handlersLayer } from '../rpc-handlers'

const decode = <A, I>(schema: Schema.Schema<A, I>, value: unknown) =>
  Schema.decodeUnknownEither(schema)(value)

describe('Commit RPC payload schema', () => {
  it('accepts a well-formed payload and rejects a missing or blank message', () => {
    const schema = Commit.payloadSchema
    expect(Either.isRight(decode(schema, { repoPath: '/repo', message: 'hi' }))).toBe(true)
    expect(Either.isLeft(decode(schema, { repoPath: '/repo' }))).toBe(true)
    expect(Either.isLeft(decode(schema, { repoPath: '/repo', message: '   ' }))).toBe(true)
    expect(Either.isLeft(decode(schema, { message: 'hi' }))).toBe(true)
  })
})

describe('Commit RPC handler', () => {
  let existingDir: string

  beforeAll(() => {
    existingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-rpc-commit-'))
  })

  afterAll(() => {
    fs.rmSync(existingDir, { recursive: true, force: true })
  })

  const commitThroughGroup = (payload: { repoPath: string; message: string }) =>
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SidecarRpcs)
      return yield* Effect.either(client.commit(payload))
    }).pipe(Effect.scoped, Effect.provide(handlersLayer))

  it('fails with a typed GitError when the repo path does not resolve', async () => {
    const result = await Effect.runPromise(
      commitThroughGroup({ repoPath: '/no/such/path/here', message: 'msg' })
    )
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(GitError)
      expect((result.left as GitError).message).toBe('invalid repository path')
    }
  })

  it('fails with a typed RepoNotOpen when the repo resolves but was never opened', async () => {
    const result = await Effect.runPromise(
      commitThroughGroup({ repoPath: existingDir, message: 'msg' })
    )
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(RepoNotOpen)
    }
  })
})

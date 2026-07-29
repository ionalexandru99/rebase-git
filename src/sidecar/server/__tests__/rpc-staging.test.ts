import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { RpcTest } from '@effect/rpc'
import { GitError, HunkNotFound, RepoNotOpen } from '@shared/git-rpc-errors'
import { SidecarRpcs, StageHunk } from '@shared/rpc'
import { Effect, Either, Schema } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { handlersLayer } from '../handlers'

const decode = <A, I>(schema: Schema.Schema<A, I>, value: unknown) =>
  Schema.decodeUnknownEither(schema)(value)

describe('StageHunk RPC payload schema', () => {
  it('rejects a payload that is missing its hunkHeader', () => {
    const schema = StageHunk.payloadSchema
    expect(
      Either.isRight(
        decode(schema, { repoPath: '/repo', file: 'a.txt', hunkHeader: '@@ -1 +1 @@' })
      )
    ).toBe(true)
    expect(Either.isLeft(decode(schema, { repoPath: '/repo', file: 'a.txt' }))).toBe(true)
    expect(
      Either.isLeft(decode(schema, { repoPath: '/repo', file: 'a.txt', hunkHeader: '   ' }))
    ).toBe(true)
  })
})

describe('staging RPC handlers', () => {
  let existingDir: string

  beforeAll(() => {
    existingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-rpc-staging-'))
  })

  afterAll(() => {
    fs.rmSync(existingDir, { recursive: true, force: true })
  })

  const stageFile = (payload: { repoPath: string; file: string }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(SidecarRpcs)
        return yield* Effect.either(client.stageFile(payload))
      }).pipe(Effect.scoped, Effect.provide(handlersLayer))
    )

  const unstageFile = (payload: { repoPath: string; file: string }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(SidecarRpcs)
        return yield* Effect.either(client.unstageFile(payload))
      }).pipe(Effect.scoped, Effect.provide(handlersLayer))
    )

  const stageAll = (payload: { repoPath: string; files: string[] }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(SidecarRpcs)
        return yield* Effect.either(client.stageAll(payload))
      }).pipe(Effect.scoped, Effect.provide(handlersLayer))
    )

  const unstageAll = (payload: { repoPath: string; files: string[] }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(SidecarRpcs)
        return yield* Effect.either(client.unstageAll(payload))
      }).pipe(Effect.scoped, Effect.provide(handlersLayer))
    )

  const stageHunk = (payload: { repoPath: string; file: string; hunkHeader: string }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(SidecarRpcs)
        return yield* Effect.either(client.stageHunk(payload))
      }).pipe(Effect.scoped, Effect.provide(handlersLayer))
    )

  const unstageHunk = (payload: { repoPath: string; file: string; hunkHeader: string }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(SidecarRpcs)
        return yield* Effect.either(client.unstageHunk(payload))
      }).pipe(Effect.scoped, Effect.provide(handlersLayer))
    )

  const discardChanges = (payload: { repoPath: string; files: string[] }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(SidecarRpcs)
        return yield* Effect.either(client.discardChanges(payload))
      }).pipe(Effect.scoped, Effect.provide(handlersLayer))
    )

  const discardAll = (payload: { repoPath: string }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(SidecarRpcs)
        return yield* Effect.either(client.discardAll(payload))
      }).pipe(Effect.scoped, Effect.provide(handlersLayer))
    )

  it('fails every file op with a typed GitError when the repo path does not resolve', async () => {
    const missing = '/no/such/path/here'
    const results = await Promise.all([
      stageFile({ repoPath: missing, file: 'a.txt' }),
      unstageFile({ repoPath: missing, file: 'a.txt' }),
      stageAll({ repoPath: missing, files: ['a.txt'] }),
      unstageAll({ repoPath: missing, files: ['a.txt'] }),
      stageHunk({ repoPath: missing, file: 'a.txt', hunkHeader: '@@ -1 +1 @@' }),
      unstageHunk({ repoPath: missing, file: 'a.txt', hunkHeader: '@@ -1 +1 @@' }),
      discardChanges({ repoPath: missing, files: ['a.txt'] }),
      discardAll({ repoPath: missing })
    ])
    for (const result of results) {
      expect(Either.isLeft(result)).toBe(true)
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(GitError)
        expect((result.left as GitError).message).toBe('invalid repository path')
      }
    }
  })

  it('fails every op with a typed RepoNotOpen when the repo resolves but was never opened', async () => {
    const results: Either.Either<void, { _tag: string; message?: string }>[] = await Promise.all([
      stageFile({ repoPath: existingDir, file: 'a.txt' }),
      unstageFile({ repoPath: existingDir, file: 'a.txt' }),
      stageAll({ repoPath: existingDir, files: ['a.txt'] }),
      unstageAll({ repoPath: existingDir, files: ['a.txt'] }),
      stageHunk({ repoPath: existingDir, file: 'a.txt', hunkHeader: '@@ -1 +1 @@' }),
      unstageHunk({ repoPath: existingDir, file: 'a.txt', hunkHeader: '@@ -1 +1 @@' }),
      discardChanges({ repoPath: existingDir, files: ['a.txt'] }),
      discardAll({ repoPath: existingDir })
    ])
    for (const result of results) {
      expect(Either.isLeft(result)).toBe(true)
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(RepoNotOpen)
      }
    }
  })

  it('rejects a file path that escapes the repo root with a typed GitError', async () => {
    const results: Either.Either<void, { _tag: string; message?: string }>[] = await Promise.all([
      stageFile({ repoPath: existingDir, file: '../escape' }),
      stageAll({ repoPath: existingDir, files: ['../escape'] }),
      stageHunk({ repoPath: existingDir, file: '../escape', hunkHeader: '@@ -1 +1 @@' }),
      discardChanges({ repoPath: existingDir, files: ['../escape'] })
    ])
    for (const result of results) {
      expect(Either.isLeft(result)).toBe(true)
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(GitError)
        expect((result.left as GitError).message).toBe('invalid repository path')
      }
    }
  })

  it('keeps HunkNotFound out of the file-resolution guard (an escape stays a GitError)', async () => {
    const result = await stageHunk({
      repoPath: existingDir,
      file: '../escape',
      hunkHeader: '@@ -1 +1 @@'
    })
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).not.toBeInstanceOf(HunkNotFound)
      expect(result.left).toBeInstanceOf(GitError)
    }
  })
})

import fs from 'node:fs'
import path from 'node:path'
import { RpcTest } from '@effect/rpc'
import { Conflict, GitError } from '@shared/git-rpc-errors'
import { SidecarRpcs } from '@shared/rpc'
import { Effect, Either } from 'effect'
import { describe, expect, it } from 'vitest'
import { closeRepo, openRepo } from '../../operations/index'
import {
  type ConflictedRepo,
  type ConflictFixtureKind,
  git,
  gitOutput,
  makeConflictedRepo,
  removeRepoDir,
  writeRepoFile
} from '../../test-support/repo-fixtures'
import { runOp } from '../../test-support/run-op'
import { handlersLayer } from '../handlers'

const abortThroughGroup = (payload: { repoPath: string }) =>
  runOp(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SidecarRpcs)
      return yield* Effect.either(client.abortOperation(payload))
    }).pipe(Effect.scoped, Effect.provide(handlersLayer))
  )

const continueThroughGroup = (payload: { repoPath: string }) =>
  runOp(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SidecarRpcs)
      return yield* Effect.either(client.continueOperation(payload))
    }).pipe(Effect.scoped, Effect.provide(handlersLayer))
  )

const resolveThroughGroup = (payload: {
  repoPath: string
  file: string
  side: 'ours' | 'theirs'
}) =>
  runOp(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SidecarRpcs)
      return yield* Effect.either(client.resolveConflict(payload))
    }).pipe(Effect.scoped, Effect.provide(handlersLayer))
  )

const statusThroughGroup = (payload: { repoPath: string }) =>
  runOp(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SidecarRpcs)
      return yield* Effect.either(client.getStatus(payload))
    }).pipe(Effect.scoped, Effect.provide(handlersLayer))
  )

async function withConflictedRepo<T>(
  kind: ConflictFixtureKind,
  use: (fixture: ConflictedRepo) => Promise<T>
): Promise<T> {
  const fixture = makeConflictedRepo(kind)
  await runOp(openRepo(fixture.path))
  try {
    return await use(fixture)
  } finally {
    await runOp(closeRepo(fixture.path))
    removeRepoDir(fixture.path)
  }
}

describe('conflict control RPC handlers', () => {
  it('aborts an in-progress merge and reports no operation in the next status', async () => {
    await withConflictedRepo('merge', async (fixture) => {
      const result = await abortThroughGroup({ repoPath: fixture.path })
      expect(Either.isRight(result)).toBe(true)

      const status = await statusThroughGroup({ repoPath: fixture.path })
      expect(Either.isRight(status)).toBe(true)
      if (Either.isRight(status)) {
        expect(status.right.status.operation).toBeUndefined()
      }
      expect(gitOutput(fixture.path, ['rev-parse', 'HEAD']).trim()).toBe(fixture.headBefore)
    })
  })

  it('carries the operation state to the renderer through getStatus', async () => {
    await withConflictedRepo('rebase', async (fixture) => {
      const status = await statusThroughGroup({ repoPath: fixture.path })
      expect(Either.isRight(status)).toBe(true)
      if (Either.isRight(status)) {
        expect(status.right.status.operation).toMatchObject({
          kind: 'rebase-merge',
          oursLabel: 'main',
          theirsLabel: 'feature'
        })
      }
    })
  })

  it('resolves a conflict from a repo-relative path', async () => {
    await withConflictedRepo('merge', async (fixture) => {
      const result = await resolveThroughGroup({
        repoPath: fixture.path,
        file: 'f.txt',
        side: 'theirs'
      })
      expect(Either.isRight(result)).toBe(true)
      expect(fs.readFileSync(path.join(fixture.path, 'f.txt'), 'utf8')).toBe('feature\n')
    })
  })

  it('rejects every file path that is not plainly repo-relative', async () => {
    await withConflictedRepo('merge', async (fixture) => {
      // An absolute path is refused even when it points inside the repo at a genuinely conflicted
      // file: the handler's contract is a repo-relative path, and nothing else gets to git.
      const rejected = [
        `..${path.sep}outside.txt`,
        path.join(fixture.path, 'f.txt'),
        path.join(path.parse(fixture.path).root, 'outside.txt'),
        'f.txt\0.png'
      ]

      for (const file of rejected) {
        const result = await resolveThroughGroup({ repoPath: fixture.path, file, side: 'ours' })
        expect(Either.isLeft(result), `expected ${JSON.stringify(file)} to be rejected`).toBe(true)
        if (Either.isLeft(result)) {
          expect(result.left).toBeInstanceOf(GitError)
          expect((result.left as GitError).message).toBe('invalid repository path')
        }
      }

      expect(fs.readFileSync(path.join(fixture.path, 'f.txt'), 'utf8')).toContain('<<<<<<<')
    })
  })

  it('surfaces a typed Conflict when continuing lands on the next conflicting commit', async () => {
    await withConflictedRepo('cherry-pick-sequence', async (fixture) => {
      writeRepoFile(fixture.path, 'a.txt', 'resolved a\n')
      git(fixture.path, ['add', '--', 'a.txt'])

      const result = await continueThroughGroup({ repoPath: fixture.path })
      expect(Either.isLeft(result)).toBe(true)
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(Conflict)
      }
    })
  })

  it('fails with a typed GitError when the repo path does not resolve', async () => {
    const result = await abortThroughGroup({ repoPath: '/no/such/path/here' })
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(GitError)
      expect((result.left as GitError).message).toBe('invalid repository path')
    }
  })
})

import type { GitStatus } from '@shared/schemas/git'
import { Effect, Either } from 'effect'
import { describe, expect, it } from 'vitest'
import type { RepoSessions } from '../../session/sessions'
import {
  conflictedPaths,
  gitOutput,
  makeStashConflictRepo,
  readRepoFile,
  removeRepoDir,
  type StashConflictRepo
} from '../../test-support/repo-fixtures'
import { runOp } from '../../test-support/run-op'
import {
  abortOperation,
  closeRepo,
  continueOperation,
  getStatus,
  openRepo,
  resolveConflict,
  stashApply,
  stashList,
  stashPop
} from '../index'

async function withStashConflictRepo<T>(
  use: (fixture: StashConflictRepo) => Promise<T>
): Promise<T> {
  const fixture = makeStashConflictRepo()
  await runOp(openRepo(fixture.path))
  try {
    return await use(fixture)
  } finally {
    await runOp(closeRepo(fixture.path))
    removeRepoDir(fixture.path)
  }
}

async function failure<A, E extends { _tag: string }>(
  effect: Effect.Effect<A, E, RepoSessions>
): Promise<{ _tag: string; message?: string }> {
  const result = await runOp(Effect.either(effect))
  if (Either.isRight(result)) {
    throw new Error('expected the operation to fail')
  }
  return result.left as { _tag: string; message?: string }
}

async function readStatus(repoPath: string): Promise<GitStatus> {
  return (await runOp(getStatus(repoPath))).status
}

function stagedEntry(repo: string, file: string): string {
  const line = gitOutput(repo, ['status', '--porcelain', '--', file]).split('\n')[0] ?? ''
  return line.slice(0, 2)
}

describe('a stash that cannot be applied cleanly', () => {
  it('reports Conflict for a pop, with conflicted files and no operation in progress', async () => {
    await withStashConflictRepo(async (fixture) => {
      const error = await failure(stashPop(fixture.path, 0, fixture.stashOid))
      expect(error._tag).toBe('Conflict')

      const status = await readStatus(fixture.path)
      expect(status.conflicted).toContain(fixture.file)
      expect(status.operation).toBeUndefined()
    })
  })

  it('keeps the stash entry after a conflicted pop', async () => {
    await withStashConflictRepo(async (fixture) => {
      await failure(stashPop(fixture.path, 0, fixture.stashOid))

      const { stashes } = await runOp(stashList(fixture.path))
      expect(stashes).toHaveLength(1)
      expect(stashes[0].oid).toBe(fixture.stashOid)
      expect(stashes[0].message).toBe('stashed work')
    })
  })

  it('reports Conflict for an apply and keeps the entry', async () => {
    await withStashConflictRepo(async (fixture) => {
      const error = await failure(stashApply(fixture.path, 0, fixture.stashOid))
      expect(error._tag).toBe('Conflict')

      const status = await readStatus(fixture.path)
      expect(status.conflicted).toContain(fixture.file)
      expect(status.operation).toBeUndefined()
      expect((await runOp(stashList(fixture.path))).stashes).toHaveLength(1)
    })
  })

  it('refuses a second apply for the unresolved conflict, not for an operation', async () => {
    await withStashConflictRepo(async (fixture) => {
      await failure(stashApply(fixture.path, 0, fixture.stashOid))

      const error = await failure(stashApply(fixture.path, 0, fixture.stashOid))

      expect(error._tag).toBe('GitError')
      expect(error.message).toBe('cannot stash: resolve the current conflicts first')
      expect(conflictedPaths(fixture.path)).toEqual([fixture.file])
      expect((await readStatus(fixture.path)).operation).toBeUndefined()
    })
  })

  it('resolves to the branch side with no operation to read the stages from', async () => {
    await withStashConflictRepo(async (fixture) => {
      await failure(stashPop(fixture.path, 0, fixture.stashOid))

      await runOp(resolveConflict(fixture.path, fixture.file, 'ours'))

      expect(readRepoFile(fixture.path, fixture.file)).toBe(fixture.oursContent)
      expect(conflictedPaths(fixture.path)).toEqual([])
      const status = await readStatus(fixture.path)
      expect(status.conflicted).toEqual([])
      expect(status.operation).toBeUndefined()
    })
  })

  it('resolves to the stashed side', async () => {
    await withStashConflictRepo(async (fixture) => {
      await failure(stashPop(fixture.path, 0, fixture.stashOid))

      await runOp(resolveConflict(fixture.path, fixture.file, 'theirs'))

      expect(readRepoFile(fixture.path, fixture.file)).toBe(fixture.theirsContent)
      expect(stagedEntry(fixture.path, fixture.file)).toBe('M ')
      const status = await readStatus(fixture.path)
      expect(status.conflicted).toEqual([])
      expect(status.operation).toBeUndefined()
    })
  })

  it('refuses to abort and leaves the conflict untouched', async () => {
    await withStashConflictRepo(async (fixture) => {
      await failure(stashPop(fixture.path, 0, fixture.stashOid))
      const conflictedContents = readRepoFile(fixture.path, fixture.file)

      const error = await failure(abortOperation(fixture.path))

      expect(error._tag).toBe('GitError')
      expect(error.message).toMatch(/no git operation in progress/i)
      expect(conflictedPaths(fixture.path)).toEqual([fixture.file])
      expect(readRepoFile(fixture.path, fixture.file)).toBe(conflictedContents)
      expect((await runOp(stashList(fixture.path))).stashes).toHaveLength(1)
    })
  })

  it('refuses to continue and leaves the conflict untouched', async () => {
    await withStashConflictRepo(async (fixture) => {
      await failure(stashPop(fixture.path, 0, fixture.stashOid))
      const conflictedContents = readRepoFile(fixture.path, fixture.file)
      const headBefore = gitOutput(fixture.path, ['rev-parse', 'HEAD']).trim()

      const error = await failure(continueOperation(fixture.path))

      expect(error._tag).toBe('GitError')
      expect(error.message).toMatch(/no git operation in progress/i)
      expect(gitOutput(fixture.path, ['rev-parse', 'HEAD']).trim()).toBe(headBefore)
      expect(conflictedPaths(fixture.path)).toEqual([fixture.file])
      expect(readRepoFile(fixture.path, fixture.file)).toBe(conflictedContents)
    })
  })
})

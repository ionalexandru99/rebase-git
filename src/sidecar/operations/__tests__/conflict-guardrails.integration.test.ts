import { Effect, Either } from 'effect'
import { describe, expect, it } from 'vitest'
import type { RepoSessions } from '../../session/sessions'
import {
  type ConflictedRepo,
  conflictedPaths,
  gitOutput,
  makeConflictedRepo,
  readRepoFile,
  removeRepoDir,
  writeRepoFile
} from '../../test-support/repo-fixtures'
import { runOp } from '../../test-support/run-op'
import {
  checkoutRef,
  closeRepo,
  discardAll,
  discardChanges,
  getStatus,
  mergeBranch,
  openRepo,
  stashList,
  stashPush
} from '../index'

async function withMergeConflict<T>(use: (fixture: ConflictedRepo) => Promise<T>): Promise<T> {
  const fixture = makeConflictedRepo('merge')
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

async function operationKind(repoPath: string): Promise<string | undefined> {
  const { status } = await runOp(getStatus(repoPath))
  return status.operation?.kind
}

function branchOf(repo: string): string {
  return gitOutput(repo, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()
}

describe('operations attempted while a merge conflict is unresolved', () => {
  it('refuses to check out another branch and stays where it is', async () => {
    await withMergeConflict(async (fixture) => {
      const headBefore = gitOutput(fixture.path, ['rev-parse', 'HEAD']).trim()

      const error = await failure(checkoutRef(fixture.path, 'local', 'feature'))

      expect(error._tag).toBe('GitError')
      expect(error.message).toMatch(/resolve your current index|needs merge/i)
      expect(branchOf(fixture.path)).toBe('main')
      expect(gitOutput(fixture.path, ['rev-parse', 'HEAD']).trim()).toBe(headBefore)
      expect(conflictedPaths(fixture.path)).toEqual(['f.txt'])
      expect(await operationKind(fixture.path)).toBe('merge')
    })
  })

  it('refuses to stash and leaves the conflict and the stash list alone', async () => {
    await withMergeConflict(async (fixture) => {
      const error = await failure(stashPush(fixture.path, 'wip'))

      expect(error._tag).toBe('GitError')
      expect((await runOp(stashList(fixture.path))).stashes).toEqual([])
      expect(conflictedPaths(fixture.path)).toEqual(['f.txt'])
      expect(await operationKind(fixture.path)).toBe('merge')
    })
  })

  // Discarding a conflicted file is a resolution, not a refusal: restoring it from HEAD drops the
  // unmerged stages, so the file silently ends up on our side with the merge still in progress.
  it('resolves a conflicted file to our side when its changes are discarded', async () => {
    await withMergeConflict(async (fixture) => {
      expect(conflictedPaths(fixture.path)).toEqual(['f.txt'])

      await runOp(discardChanges(fixture.path, ['f.txt']))

      expect(readRepoFile(fixture.path, 'f.txt')).toBe('main\n')
      expect(conflictedPaths(fixture.path)).toEqual([])
      expect(await operationKind(fixture.path)).toBe('merge')
    })
  })

  // `reset --hard` clears MERGE_HEAD, so discarding everything ends the merge as surely as an abort
  // would — it just never says so.
  it('ends the merge outright when every change is discarded', async () => {
    await withMergeConflict(async (fixture) => {
      writeRepoFile(fixture.path, 'stray.txt', 'untracked\n')

      await runOp(discardAll(fixture.path))

      expect(readRepoFile(fixture.path, 'f.txt')).toBe('main\n')
      expect(gitOutput(fixture.path, ['status', '--porcelain']).trim()).toBe('')
      expect(gitOutput(fixture.path, ['rev-parse', 'HEAD']).trim()).toBe(fixture.headBefore)
      expect(await operationKind(fixture.path)).toBeUndefined()
    })
  })

  it('refuses a second merge up front without disturbing the first', async () => {
    await withMergeConflict(async (fixture) => {
      const headBefore = gitOutput(fixture.path, ['rev-parse', 'HEAD']).trim()
      const conflictedContents = readRepoFile(fixture.path, 'f.txt')

      const error = await failure(mergeBranch(fixture.path, 'local', 'feature'))

      expect(error._tag).toBe('GitError')
      expect(error.message).toBe('cannot merge: resolve the current conflicts first')
      expect(gitOutput(fixture.path, ['rev-parse', 'HEAD']).trim()).toBe(headBefore)
      expect(readRepoFile(fixture.path, 'f.txt')).toBe(conflictedContents)
      expect(conflictedPaths(fixture.path)).toEqual(['f.txt'])
      expect(await operationKind(fixture.path)).toBe('merge')
    })
  })
})

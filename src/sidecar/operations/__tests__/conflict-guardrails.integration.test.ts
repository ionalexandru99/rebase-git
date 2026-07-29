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
  cherryPick,
  closeRepo,
  createBranch,
  discardAll,
  discardChanges,
  getStatus,
  mergeBranch,
  openRepo,
  resetToCommit,
  resolveConflict,
  stashList,
  stashPush,
  unstageAll,
  unstageFile
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

      expect(error).toMatchObject({ _tag: 'OperationInProgress', operation: 'merge' })
      expect(branchOf(fixture.path)).toBe('main')
      expect(gitOutput(fixture.path, ['rev-parse', 'HEAD']).trim()).toBe(headBefore)
      expect(conflictedPaths(fixture.path)).toEqual(['f.txt'])
      expect(await operationKind(fixture.path)).toBe('merge')
    })
  })

  it('refuses to stash and leaves the conflict and the stash list alone', async () => {
    await withMergeConflict(async (fixture) => {
      const error = await failure(stashPush(fixture.path, 'wip'))

      expect(error).toMatchObject({ _tag: 'OperationInProgress', operation: 'merge' })
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

      expect(error).toMatchObject({ _tag: 'OperationInProgress', operation: 'merge' })
      expect(gitOutput(fixture.path, ['rev-parse', 'HEAD']).trim()).toBe(headBefore)
      expect(readRepoFile(fixture.path, 'f.txt')).toBe(conflictedContents)
      expect(conflictedPaths(fixture.path)).toEqual(['f.txt'])
      expect(await operationKind(fixture.path)).toBe('merge')
    })
  })
})

// Resolving the last conflicted file empties the index of unmerged paths while the sequence itself is
// still parked. Git starts a second operation in that window without complaint: it commits, deletes
// CHERRY_PICK_HEAD and strands the remaining todo, so the step the user had just resolved is dropped
// on the floor and never applied. Only the marker files still say the repository is mid-sequence.
describe('a sequence parked with every conflict already resolved', () => {
  async function withResolvedSequence<T>(use: (fixture: ConflictedRepo) => Promise<T>): Promise<T> {
    const fixture = makeConflictedRepo('cherry-pick-sequence')
    await runOp(openRepo(fixture.path))
    try {
      for (const file of conflictedPaths(fixture.path)) {
        await runOp(resolveConflict(fixture.path, file, 'ours'))
      }
      return await use(fixture)
    } finally {
      await runOp(closeRepo(fixture.path))
      removeRepoDir(fixture.path)
    }
  }

  const sequencerTodo = (repo: string): string =>
    gitOutput(repo, ['rev-parse', '--git-path', 'sequencer/todo']).trim()

  it('looks clean to git yet is still mid-sequence', async () => {
    await withResolvedSequence(async (fixture) => {
      expect(conflictedPaths(fixture.path)).toEqual([])
      expect(gitOutput(fixture.path, ['status', '--porcelain']).trim()).toBe('')
      expect(await operationKind(fixture.path)).toBe('cherry-pick')
    })
  })

  it('refuses a cherry-pick and leaves the pending step and its resolution intact', async () => {
    await withResolvedSequence(async (fixture) => {
      const headBefore = gitOutput(fixture.path, ['rev-parse', 'HEAD']).trim()
      const todoBefore = readRepoFile(fixture.path, sequencerTodo(fixture.path))

      const error = await failure(cherryPick(fixture.path, 'feature'))

      expect(error).toMatchObject({ _tag: 'OperationInProgress', operation: 'cherry-pick' })
      expect(gitOutput(fixture.path, ['rev-parse', 'HEAD']).trim()).toBe(headBefore)
      expect(readRepoFile(fixture.path, sequencerTodo(fixture.path))).toBe(todoBefore)
      expect(await operationKind(fixture.path)).toBe('cherry-pick')
    })
  })

  it('refuses a merge just the same', async () => {
    await withResolvedSequence(async (fixture) => {
      const headBefore = gitOutput(fixture.path, ['rev-parse', 'HEAD']).trim()

      const error = await failure(mergeBranch(fixture.path, 'local', 'feature'))

      expect(error).toMatchObject({ _tag: 'OperationInProgress', operation: 'cherry-pick' })
      expect(gitOutput(fixture.path, ['rev-parse', 'HEAD']).trim()).toBe(headBefore)
      expect(await operationKind(fixture.path)).toBe('cherry-pick')
    })
  })
})

// Two more ways to walk off with the resolution once the index holds no unmerged entries. git accepts
// both: `stash push` banks the resolution and deletes MERGE_HEAD, ending the merge silently, and
// unstaging resets the index entry to HEAD so the merge commit records HEAD's side while the side the
// user picked is left behind as an unstaged change.
describe('a merge parked with its conflict already resolved', () => {
  async function withResolvedMerge<T>(use: (fixture: ConflictedRepo) => Promise<T>): Promise<T> {
    const fixture = makeConflictedRepo('merge')
    await runOp(openRepo(fixture.path))
    try {
      for (const file of conflictedPaths(fixture.path)) {
        await runOp(resolveConflict(fixture.path, file, 'theirs'))
      }
      return await use(fixture)
    } finally {
      await runOp(closeRepo(fixture.path))
      removeRepoDir(fixture.path)
    }
  }

  it('refuses to stash the resolution out from under the merge', async () => {
    await withResolvedMerge(async (fixture) => {
      const resolved = readRepoFile(fixture.path, 'f.txt')

      const error = await failure(stashPush(fixture.path, 'wip'))

      expect(error).toMatchObject({ _tag: 'OperationInProgress', operation: 'merge' })
      expect((await runOp(stashList(fixture.path))).stashes).toEqual([])
      expect(readRepoFile(fixture.path, 'f.txt')).toBe(resolved)
      expect(await operationKind(fixture.path)).toBe('merge')
    })
  })

  it('refuses to unstage a resolved file and keeps the resolution in the index', async () => {
    await withResolvedMerge(async (fixture) => {
      const stagedBefore = gitOutput(fixture.path, ['diff', '--cached', '--name-only'])

      const error = await failure(unstageFile(fixture.path, 'f.txt'))

      expect(error).toMatchObject({ _tag: 'OperationInProgress', operation: 'merge' })
      expect(gitOutput(fixture.path, ['diff', '--cached', '--name-only'])).toBe(stagedBefore)
      expect(await operationKind(fixture.path)).toBe('merge')
    })
  })

  it('refuses to unstage every file at once', async () => {
    await withResolvedMerge(async (fixture) => {
      const error = await failure(unstageAll(fixture.path, ['f.txt']))

      expect(error).toMatchObject({ _tag: 'OperationInProgress', operation: 'merge' })
      expect(await operationKind(fixture.path)).toBe('merge')
    })
  })

  // A path the incoming side never touches cannot be carrying a resolution, so whatever is staged for
  // it is the user's own work. Refusing it would be a trap: `merge --abort` is then the only way out
  // and it discards that work along with the merge.
  it('lets an unrelated staged edit be unstaged and discarded', async () => {
    await withResolvedMerge(async (fixture) => {
      writeRepoFile(fixture.path, 'unrelated.txt', 'my own work\n')
      gitOutput(fixture.path, ['add', '--', 'unrelated.txt'])

      await runOp(unstageFile(fixture.path, 'unrelated.txt'))

      expect(gitOutput(fixture.path, ['diff', '--cached', '--name-only']).trim()).toBe('f.txt')
      expect(readRepoFile(fixture.path, 'unrelated.txt')).toBe('my own work\n')
      expect(await operationKind(fixture.path)).toBe('merge')
    })
  })

  // Discarding a file that is still conflicted stays allowed — that is a resolution toward our side,
  // covered above. Discarding one that is already resolved is the reverse: it puts HEAD back over the
  // resolution and the merge commit then records HEAD's side.
  it('refuses to discard a file whose conflict is already resolved', async () => {
    await withResolvedMerge(async (fixture) => {
      const resolved = readRepoFile(fixture.path, 'f.txt')

      const error = await failure(discardChanges(fixture.path, ['f.txt']))

      expect(error).toMatchObject({ _tag: 'OperationInProgress', operation: 'merge' })
      expect(readRepoFile(fixture.path, 'f.txt')).toBe(resolved)
      expect(await operationKind(fixture.path)).toBe('merge')
    })
  })

  // Every mode moves HEAD, and moving HEAD deletes the operation's marker; --hard also throws away
  // the staged resolution on the way past.
  it.each(['soft', 'mixed', 'hard'] as const)('refuses a %s reset', async (mode) => {
    await withResolvedMerge(async (fixture) => {
      const resolved = readRepoFile(fixture.path, 'f.txt')

      const error = await failure(resetToCommit(fixture.path, `${fixture.headBefore}~1`, mode))

      expect(error).toMatchObject({ _tag: 'OperationInProgress', operation: 'merge' })
      expect(gitOutput(fixture.path, ['rev-parse', 'HEAD']).trim()).toBe(fixture.headBefore)
      expect(readRepoFile(fixture.path, 'f.txt')).toBe(resolved)
      expect(await operationKind(fixture.path)).toBe('merge')
    })
  })
})

// Moving HEAD is the third way out. git does not refuse a checkout for a parked cherry-pick or
// revert the way it does for a conflicted index — it cancels the operation to make room, says so in a
// warning that never reaches a GUI, and the resolution waiting on Continue goes with it.
describe('checking out while a cherry-pick is parked with its conflict resolved', () => {
  async function withResolvedPick<T>(use: (fixture: ConflictedRepo) => Promise<T>): Promise<T> {
    const fixture = makeConflictedRepo('cherry-pick')
    await runOp(openRepo(fixture.path))
    try {
      for (const file of conflictedPaths(fixture.path)) {
        await runOp(resolveConflict(fixture.path, file, 'ours'))
      }
      return await use(fixture)
    } finally {
      await runOp(closeRepo(fixture.path))
      removeRepoDir(fixture.path)
    }
  }

  it('refuses the checkout and stays on the branch with the operation intact', async () => {
    await withResolvedPick(async (fixture) => {
      const error = await failure(checkoutRef(fixture.path, 'local', 'feature'))

      expect(error).toMatchObject({ _tag: 'OperationInProgress', operation: 'cherry-pick' })
      expect(branchOf(fixture.path)).toBe(fixture.branchBefore)
      expect(await operationKind(fixture.path)).toBe('cherry-pick')
    })
  })

  it('refuses a branch created with checkout but allows one created without', async () => {
    await withResolvedPick(async (fixture) => {
      const error = await failure(createBranch(fixture.path, 'switched', undefined, true))

      expect(error).toMatchObject({ _tag: 'OperationInProgress', operation: 'cherry-pick' })
      expect(branchOf(fixture.path)).toBe(fixture.branchBefore)

      await runOp(createBranch(fixture.path, 'parked', undefined, false))

      expect(branchOf(fixture.path)).toBe(fixture.branchBefore)
      expect(await operationKind(fixture.path)).toBe('cherry-pick')
    })
  })
})

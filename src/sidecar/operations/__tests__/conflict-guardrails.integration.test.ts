import fs from 'node:fs'
import path from 'node:path'
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
  rebaseOnto,
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

  it('resolves a conflicted file to our side when its changes are discarded', async () => {
    await withMergeConflict(async (fixture) => {
      expect(conflictedPaths(fixture.path)).toEqual(['f.txt'])

      await runOp(discardChanges(fixture.path, ['f.txt']))

      expect(readRepoFile(fixture.path, 'f.txt')).toBe('main\n')
      expect(conflictedPaths(fixture.path)).toEqual([])
      expect(await operationKind(fixture.path)).toBe('merge')
    })
  })

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

  it('refuses a rebase up front without disturbing the merge', async () => {
    await withMergeConflict(async (fixture) => {
      const headBefore = gitOutput(fixture.path, ['rev-parse', 'HEAD']).trim()
      const conflictedContents = readRepoFile(fixture.path, 'f.txt')

      const error = await failure(rebaseOnto(fixture.path, 'local', 'feature'))

      expect(error).toMatchObject({ _tag: 'OperationInProgress', operation: 'merge' })
      expect(gitOutput(fixture.path, ['rev-parse', 'HEAD']).trim()).toBe(headBefore)
      expect(readRepoFile(fixture.path, 'f.txt')).toBe(conflictedContents)
      expect(conflictedPaths(fixture.path)).toEqual(['f.txt'])
      expect(await operationKind(fixture.path)).toBe('merge')
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

  it('lets an unrelated staged edit be unstaged and discarded', async () => {
    await withResolvedMerge(async (fixture) => {
      writeRepoFile(fixture.path, 'unrelated.txt', 'my own work\n')
      gitOutput(fixture.path, ['add', '--', 'unrelated.txt'])

      await runOp(unstageFile(fixture.path, 'unrelated.txt'))

      expect(gitOutput(fixture.path, ['diff', '--cached', '--name-only']).trim()).toBe('f.txt')
      expect(readRepoFile(fixture.path, 'unrelated.txt')).toBe('my own work\n')
      expect(await operationKind(fixture.path)).toBe('merge')

      await runOp(discardChanges(fixture.path, ['unrelated.txt']))

      expect(fs.existsSync(path.join(fixture.path, 'unrelated.txt'))).toBe(false)
      expect(gitOutput(fixture.path, ['diff', '--cached', '--name-only']).trim()).toBe('f.txt')
      expect(await operationKind(fixture.path)).toBe('merge')
    })
  })

  it('refuses to discard a file whose conflict is already resolved', async () => {
    await withResolvedMerge(async (fixture) => {
      const resolved = readRepoFile(fixture.path, 'f.txt')

      const error = await failure(discardChanges(fixture.path, ['f.txt']))

      expect(error).toMatchObject({ _tag: 'OperationInProgress', operation: 'merge' })
      expect(readRepoFile(fixture.path, 'f.txt')).toBe(resolved)
      expect(await operationKind(fixture.path)).toBe('merge')
    })
  })

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

describe('a revert parked with one path conflicted and another reversed cleanly', () => {
  async function withPartialRevert<T>(use: (fixture: ConflictedRepo) => Promise<T>): Promise<T> {
    const fixture = makeConflictedRepo('revert-partial')
    await runOp(openRepo(fixture.path))
    try {
      return await use(fixture)
    } finally {
      await runOp(closeRepo(fixture.path))
      removeRepoDir(fixture.path)
    }
  }

  it('stages the clean reversal even though HEAD and REVERT_HEAD agree on it', async () => {
    await withPartialRevert(async (fixture) => {
      expect(conflictedPaths(fixture.path)).toEqual(['a.txt'])
      expect(
        gitOutput(fixture.path, [
          'diff',
          '--name-only',
          'HEAD',
          'REVERT_HEAD',
          '--',
          'b.txt'
        ]).trim()
      ).toBe('')
      expect(gitOutput(fixture.path, ['show', ':b.txt'])).toBe('b base\n')
      expect(gitOutput(fixture.path, ['show', 'HEAD:b.txt'])).toBe('b target\n')
    })
  })

  it('refuses to unstage the clean reversal', async () => {
    await withPartialRevert(async (fixture) => {
      const error = await failure(unstageFile(fixture.path, 'b.txt'))

      expect(error).toMatchObject({ _tag: 'OperationInProgress', operation: 'revert' })
      expect(gitOutput(fixture.path, ['show', ':b.txt'])).toBe('b base\n')
      expect(await operationKind(fixture.path)).toBe('revert')
    })
  })

  it('refuses to unstage it through Unstage all as well', async () => {
    await withPartialRevert(async (fixture) => {
      const error = await failure(unstageAll(fixture.path, ['a.txt', 'b.txt']))

      expect(error).toMatchObject({ _tag: 'OperationInProgress', operation: 'revert' })
      expect(gitOutput(fixture.path, ['show', ':b.txt'])).toBe('b base\n')
    })
  })
})

describe('a merge that carried an incoming change into a renamed path', () => {
  async function withRenameCarry<T>(use: (fixture: ConflictedRepo) => Promise<T>): Promise<T> {
    const fixture = makeConflictedRepo('merge-rename-carry')
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

  it('stages the incoming change under the new name the merge delta never lists', async () => {
    await withRenameCarry(async (fixture) => {
      const base = gitOutput(fixture.path, ['merge-base', 'HEAD', 'MERGE_HEAD']).trim()
      const delta = gitOutput(fixture.path, ['diff', '--name-only', base, 'MERGE_HEAD'])
      expect(delta).not.toContain('g.txt')
      expect(gitOutput(fixture.path, ['show', ':g.txt']).trimEnd().split('\n').pop()).toBe(
        'incoming'
      )
      expect(gitOutput(fixture.path, ['show', 'HEAD:g.txt']).trimEnd().split('\n').pop()).toBe(
        'line8'
      )
    })
  })

  it('refuses to unstage the renamed path', async () => {
    await withRenameCarry(async (fixture) => {
      const error = await failure(unstageFile(fixture.path, 'g.txt'))

      expect(error).toMatchObject({ _tag: 'OperationInProgress', operation: 'merge' })
      expect(gitOutput(fixture.path, ['show', ':g.txt']).trimEnd().split('\n').pop()).toBe(
        'incoming'
      )
      expect(await operationKind(fixture.path)).toBe('merge')
    })
  })

  it('refuses to discard the renamed path', async () => {
    await withRenameCarry(async (fixture) => {
      const error = await failure(discardChanges(fixture.path, ['g.txt']))

      expect(error).toMatchObject({ _tag: 'OperationInProgress', operation: 'merge' })
      expect(await operationKind(fixture.path)).toBe('merge')
    })
  })
})

describe('a merge that relocated an incoming file through a directory rename', () => {
  async function withDirectoryRename<T>(use: (fixture: ConflictedRepo) => Promise<T>): Promise<T> {
    const fixture = makeConflictedRepo('merge-directory-rename')
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

  it('stages the addition under a path neither the delta nor the rename record names', async () => {
    await withDirectoryRename(async (fixture) => {
      const base = gitOutput(fixture.path, ['merge-base', 'HEAD', 'MERGE_HEAD']).trim()
      const delta = gitOutput(fixture.path, ['diff', '--name-only', base, 'MERGE_HEAD'])
      const renames = gitOutput(fixture.path, [
        'diff',
        '-M',
        '--name-status',
        '--diff-filter=R',
        base,
        'HEAD'
      ])
      expect(delta).toContain('old/new.txt')
      expect(delta).not.toContain('new/new.txt')
      expect(renames).not.toContain('new/new.txt')
      expect(gitOutput(fixture.path, ['show', ':new/new.txt'])).toBe('incoming file\n')
    })
  })

  it('refuses to unstage the relocated file', async () => {
    await withDirectoryRename(async (fixture) => {
      const error = await failure(unstageFile(fixture.path, 'new/new.txt'))

      expect(error).toMatchObject({ _tag: 'OperationInProgress', operation: 'merge' })
      expect(gitOutput(fixture.path, ['show', ':new/new.txt'])).toBe('incoming file\n')
      expect(await operationKind(fixture.path)).toBe('merge')
    })
  }, 30_000)
})

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

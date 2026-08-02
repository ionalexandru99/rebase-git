import { parseUnifiedDiff } from '@shared/unified-diff'
import { Effect, Either } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  conflictedPaths,
  createRepoFixture,
  makeConflictedRepo,
  type RepoFixture,
  removeRepoDir
} from '../../test-support/repo-fixtures'
import { runOp } from '../../test-support/run-op'
import { closeRepo, discardHunk, getDiff, openRepo } from '../index'

const hunksOf = (result: { patch: string }) => parseUnifiedDiff(result.patch).hunks
let repoDir: string
let repo: RepoFixture

const baseLines = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`)

beforeEach(async () => {
  repo = createRepoFixture({ prefix: 'rebase-discard-hunk-' })
  repoDir = repo.path
  repo.writeLines('sample.txt', baseLines)
  repo.git('add', '--', 'sample.txt')
  repo.commitStaged('base')
  await runOp(openRepo(repoDir))
})

afterEach(async () => {
  await runOp(closeRepo(repoDir))
  repo.cleanup()
})

describe('discardHunk against a real repository', () => {
  it('discards the middle hunk from the worktree and leaves the other hunks and the index intact', async () => {
    const edited = [...baseLines]
    edited[0] = 'line 1 EDITED'
    edited[19] = 'line 20 EDITED'
    edited[39] = 'line 40 EDITED'
    repo.writeLines('sample.txt', edited)

    const unstaged = await runOp(getDiff(repoDir, 'sample.txt', false))
    expect(hunksOf(unstaged)).toHaveLength(3)
    const middleHeader = hunksOf(unstaged)[1].header

    await runOp(discardHunk(repoDir, 'sample.txt', middleHeader))

    const worktree = repo.readLines('sample.txt')
    expect(worktree[0]).toBe('line 1 EDITED')
    expect(worktree[19]).toBe('line 20')
    expect(worktree[39]).toBe('line 40 EDITED')

    const unstagedAfter = await runOp(getDiff(repoDir, 'sample.txt', false))
    expect(hunksOf(unstagedAfter)).toHaveLength(2)

    expect(repo.git('diff', '--cached', '--name-only')).toBe('')
  })

  it('reverts the worktree to the index content and keeps staged changes staged', async () => {
    const stagedEdit = [...baseLines]
    stagedEdit[0] = 'line 1 STAGED'
    repo.writeLines('sample.txt', stagedEdit)
    repo.git('add', '--', 'sample.txt')

    const worktreeEdit = [...stagedEdit]
    worktreeEdit[39] = 'line 40 UNSTAGED'
    repo.writeLines('sample.txt', worktreeEdit)

    const unstaged = await runOp(getDiff(repoDir, 'sample.txt', false))
    expect(hunksOf(unstaged)).toHaveLength(1)

    await runOp(discardHunk(repoDir, 'sample.txt', hunksOf(unstaged)[0].header))

    const worktree = repo.readLines('sample.txt')
    expect(worktree[0]).toBe('line 1 STAGED')
    expect(worktree[39]).toBe('line 40')
    expect(repo.git('show', ':sample.txt')).toContain('line 1 STAGED')
  })

  it('returns a typed HunkNotFound for a stale hunk header and leaves the worktree untouched', async () => {
    const edited = [...baseLines]
    edited[0] = 'line 1 EDITED'
    repo.writeLines('sample.txt', edited)

    const result = await runOp(
      Effect.either(discardHunk(repoDir, 'sample.txt', '@@ -999,1 +999,1 @@'))
    )

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('HunkNotFound')
    }
    expect(repo.readLines('sample.txt')[0]).toBe('line 1 EDITED')
  })

  it('rejects a discard on a file owned by an in-progress merge with OperationInProgress', async () => {
    const fixture = makeConflictedRepo('merge')
    try {
      await runOp(openRepo(fixture.path))
      const conflicted = conflictedPaths(fixture.path)[0]
      const result = await runOp(
        Effect.either(discardHunk(fixture.path, conflicted, '@@ -1,1 +1,1 @@'))
      )
      expect(Either.isLeft(result)).toBe(true)
      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe('OperationInProgress')
      }
    } finally {
      await runOp(Effect.ignore(closeRepo(fixture.path)))
      removeRepoDir(fixture.path)
    }
  })
})

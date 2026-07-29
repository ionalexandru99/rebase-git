import fs from 'node:fs'
import path from 'node:path'
import { Effect, Either } from 'effect'
import { describe, expect, it } from 'vitest'
import type { RepoSessions } from '../../session/sessions'
import {
  type ConflictedRepo,
  type ConflictFixtureKind,
  type ConflictFixtureOptions,
  conflictedPaths,
  git,
  gitOutput,
  makeConflictedRepo,
  readRepoFile,
  removeRepoDir,
  supportsRebaseApplyBackend,
  writeRepoFile
} from '../../test-support/repo-fixtures'
import { runOp } from '../../test-support/run-op'
import {
  abortOperation,
  closeRepo,
  continueOperation,
  getStatus,
  openRepo,
  resolveConflict
} from '../index'

async function withConflictedRepo<T>(
  kind: ConflictFixtureKind,
  use: (fixture: ConflictedRepo) => Promise<T>,
  options?: ConflictFixtureOptions
): Promise<T> {
  const fixture = makeConflictedRepo(kind, options)
  await runOp(openRepo(fixture.path))
  try {
    return await use(fixture)
  } finally {
    await runOp(closeRepo(fixture.path))
    removeRepoDir(fixture.path)
  }
}

// A `--continue` that reaches for an editor lands here and never returns, so the test fails on its
// own timeout instead of passing because some ambient setting happened to defuse the prompt. git
// runs the editor as `sh -c "<core.editor> <messagefile>"`, and the trailing `#` comments the
// filename out so the command blocks rather than choking on an argument it does not understand.
const BLOCKING_EDITOR = 'sleep 30 #'
const EDITOR_TIMEOUT_MS = 10_000
const AMBIENT_EDITOR_VARS = ['GIT_EDITOR', 'GIT_SEQUENCE_EDITOR', 'EDITOR', 'VISUAL']

// nonInteractiveEnv() spreads process.env, and a developer machine or CI image commonly exports
// GIT_EDITOR=true itself — which would mask the explicit overrides and make the guarantee untested.
// Removing them for the duration of the call leaves those overrides as the only thing in the way.
async function withoutAmbientEditors<T>(run: () => Promise<T>): Promise<T> {
  const saved = AMBIENT_EDITOR_VARS.map((name) => [name, process.env[name]] as const)
  for (const name of AMBIENT_EDITOR_VARS) {
    delete process.env[name]
  }
  try {
    return await run()
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) {
        delete process.env[name]
      } else {
        process.env[name] = value
      }
    }
  }
}

function isAncestor(repo: string, ancestor: string, descendant: string): boolean {
  try {
    gitOutput(repo, ['merge-base', '--is-ancestor', ancestor, descendant])
    return true
  } catch {
    return false
  }
}

async function failureTag<A, E extends { _tag: string }>(
  effect: Effect.Effect<A, E, RepoSessions>
): Promise<string> {
  const result = await runOp(Effect.either(effect))
  if (Either.isRight(result)) {
    throw new Error('expected the operation to fail')
  }
  return result.left._tag
}

function porcelain(repo: string): string {
  return gitOutput(repo, ['status', '--porcelain']).trim()
}

function stagedEntry(repo: string, file: string): string {
  const line = gitOutput(repo, ['status', '--porcelain', '--', file]).split('\n')[0] ?? ''
  return line.slice(0, 2)
}

// The index stage each entry for `file` sits at: 0 once resolved, 1/2/3 while still conflicted.
function indexStages(repo: string, file: string): number[] {
  return gitOutput(repo, ['ls-files', '-s', '--', file])
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => Number(line.split('\t')[0].split(' ')[2]))
}

async function currentOperationKind(repoPath: string): Promise<string | undefined> {
  const { status } = await runOp(getStatus(repoPath))
  return status.operation?.kind
}

describe('abortOperation', () => {
  const abortable: ConflictFixtureKind[] = [
    'merge',
    'rebase',
    'am',
    'cherry-pick-sequence',
    'revert'
  ]

  for (const kind of abortable) {
    it(`restores the pre-operation HEAD after a ${kind} conflict`, async () => {
      await withConflictedRepo(kind, async (fixture) => {
        expect(conflictedPaths(fixture.path).length).toBeGreaterThan(0)

        await runOp(abortOperation(fixture.path))

        expect(gitOutput(fixture.path, ['rev-parse', 'HEAD']).trim()).toBe(fixture.headBefore)
        expect(gitOutput(fixture.path, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe(
          fixture.branchBefore
        )
        expect(porcelain(fixture.path)).toBe('')
        expect(await currentOperationKind(fixture.path)).toBeUndefined()
      })
    })
  }

  it.skipIf(!supportsRebaseApplyBackend())(
    'restores the pre-operation HEAD after a rebase-apply conflict',
    async () => {
      await withConflictedRepo('rebase-apply', async (fixture) => {
        await runOp(abortOperation(fixture.path))
        expect(gitOutput(fixture.path, ['rev-parse', 'HEAD']).trim()).toBe(fixture.headBefore)
        expect(await currentOperationKind(fixture.path)).toBeUndefined()
      })
    }
  )

  it('fails with a clear message when nothing is in progress', async () => {
    await withConflictedRepo('merge', async (fixture) => {
      git(fixture.path, ['merge', '--abort'])
      const result = await runOp(Effect.either(abortOperation(fixture.path)))
      expect(Either.isLeft(result)).toBe(true)
      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe('GitError')
        expect((result.left as { message: string }).message).toMatch(/no .*operation/i)
      }
    })
  })
})

describe('continueOperation', () => {
  it('completes a resolved merge using the prepared merge message', async () => {
    await withConflictedRepo('merge', async (fixture) => {
      writeRepoFile(fixture.path, 'f.txt', 'resolved\n')
      git(fixture.path, ['add', '--', 'f.txt'])

      await runOp(continueOperation(fixture.path))

      const parents = gitOutput(fixture.path, ['rev-list', '--parents', '-1', 'HEAD']).trim()
      expect(parents.split(' ').length).toBe(3)
      expect(gitOutput(fixture.path, ['log', '-1', '--format=%s']).trim()).toContain(
        "Merge branch 'feature'"
      )
      expect(porcelain(fixture.path)).toBe('')
      expect(await currentOperationKind(fixture.path)).toBeUndefined()
    })
  })

  // `git rebase --continue` launches an editor for the commit message. The repo is configured with
  // one that never returns, so this only completes because the sidecar forces GIT_EDITOR itself.
  it(
    'completes a resolved rebase without waiting on an editor',
    async () => {
      await withConflictedRepo(
        'rebase',
        async (fixture) => {
          writeRepoFile(fixture.path, 'f.txt', 'resolved\n')
          git(fixture.path, ['add', '--', 'f.txt'])

          await withoutAmbientEditors(() => runOp(continueOperation(fixture.path)))

          expect(gitOutput(fixture.path, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe(
            'feature'
          )
          expect(isAncestor(fixture.path, 'main', 'HEAD')).toBe(true)
          expect(await currentOperationKind(fixture.path)).toBeUndefined()
        },
        { config: { 'core.editor': BLOCKING_EDITOR } }
      )
    },
    EDITOR_TIMEOUT_MS
  )

  it(
    'completes a resolved revert without waiting on an editor',
    async () => {
      await withConflictedRepo(
        'revert',
        async (fixture) => {
          const headBefore = gitOutput(fixture.path, ['rev-parse', 'HEAD']).trim()
          writeRepoFile(fixture.path, 'f.txt', 'resolved\n')
          git(fixture.path, ['add', '--', 'f.txt'])

          await withoutAmbientEditors(() => runOp(continueOperation(fixture.path)))

          expect(gitOutput(fixture.path, ['rev-parse', 'HEAD']).trim()).not.toBe(headBefore)
          expect(await currentOperationKind(fixture.path)).toBeUndefined()
        },
        { config: { 'core.editor': BLOCKING_EDITOR } }
      )
    },
    EDITOR_TIMEOUT_MS
  )

  it('completes a resolved am without waiting on an editor', async () => {
    await withConflictedRepo('am', async (fixture) => {
      writeRepoFile(fixture.path, 'f.txt', 'resolved\n')
      git(fixture.path, ['add', '--', 'f.txt'])

      await runOp(continueOperation(fixture.path))

      expect(gitOutput(fixture.path, ['log', '-1', '--format=%s']).trim()).toBe('feature work')
      expect(await currentOperationKind(fixture.path)).toBeUndefined()
    })
  })

  it('reports Conflict when the next commit of a sequence conflicts, then finishes', async () => {
    await withConflictedRepo('cherry-pick-sequence', async (fixture) => {
      writeRepoFile(fixture.path, 'a.txt', 'resolved a\n')
      git(fixture.path, ['add', '--', 'a.txt'])

      expect(await failureTag(continueOperation(fixture.path))).toBe('Conflict')

      const { status } = await runOp(getStatus(fixture.path))
      expect(status.operation?.kind).toBe('cherry-pick')
      expect(status.operation?.done).toBe(2)
      expect(status.operation?.total).toBe(2)
      expect(conflictedPaths(fixture.path)).toContain('b.txt')

      writeRepoFile(fixture.path, 'b.txt', 'resolved b\n')
      git(fixture.path, ['add', '--', 'b.txt'])
      await runOp(continueOperation(fixture.path))

      expect(await currentOperationKind(fixture.path)).toBeUndefined()
      expect(gitOutput(fixture.path, ['log', '-2', '--format=%s']).trim().split('\n')).toEqual([
        'feature edits b',
        'feature edits a'
      ])
    })
  })

  it('refuses to continue while conflicts remain and leaves the operation intact', async () => {
    await withConflictedRepo('merge', async (fixture) => {
      const headBefore = gitOutput(fixture.path, ['rev-parse', 'HEAD']).trim()

      const result = await runOp(Effect.either(continueOperation(fixture.path)))
      expect(Either.isLeft(result)).toBe(true)
      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe('GitError')
        expect((result.left as { message: string }).message).toMatch(/conflict/i)
      }

      expect(gitOutput(fixture.path, ['rev-parse', 'HEAD']).trim()).toBe(headBefore)
      expect(conflictedPaths(fixture.path)).toContain('f.txt')
      expect(await currentOperationKind(fixture.path)).toBe('merge')
    })
  })

  it('fails when nothing is in progress', async () => {
    await withConflictedRepo('merge', async (fixture) => {
      git(fixture.path, ['merge', '--abort'])
      expect(await failureTag(continueOperation(fixture.path))).toBe('GitError')
    })
  })
})

// Resolving a step toward the side already in HEAD leaves git nothing to commit for it, and git
// answers `--continue` by asking for `--skip` instead. The UI only offers Continue and Abort, so the
// sequence has to advance on its own — the user chose that side, which is exactly "drop this commit".
describe('continueOperation — a step that resolves to nothing', () => {
  it('finishes a single-commit cherry-pick without adding a commit', async () => {
    await withConflictedRepo('cherry-pick', async (fixture) => {
      await runOp(resolveConflict(fixture.path, 'f.txt', 'ours'))

      await runOp(continueOperation(fixture.path))

      expect(gitOutput(fixture.path, ['rev-parse', 'HEAD']).trim()).toBe(fixture.headBefore)
      expect(readRepoFile(fixture.path, 'f.txt')).toBe('main\n')
      expect(porcelain(fixture.path)).toBe('')
      expect(await currentOperationKind(fixture.path)).toBeUndefined()
    })
  })

  it('skips the empty commit of a sequence and reports the conflict the next one hits', async () => {
    await withConflictedRepo('cherry-pick-sequence', async (fixture) => {
      await runOp(resolveConflict(fixture.path, 'a.txt', 'ours'))

      expect(await failureTag(continueOperation(fixture.path))).toBe('Conflict')

      const { status } = await runOp(getStatus(fixture.path))
      expect(status.operation?.kind).toBe('cherry-pick')
      expect(conflictedPaths(fixture.path)).toContain('b.txt')

      await runOp(resolveConflict(fixture.path, 'b.txt', 'theirs'))
      await runOp(continueOperation(fixture.path))

      expect(await currentOperationKind(fixture.path)).toBeUndefined()
      // Only the second commit landed: the first one is the one that resolved to nothing.
      expect(
        gitOutput(fixture.path, ['log', '--format=%s', `${fixture.headBefore}..HEAD`]).trim()
      ).toBe('feature edits b')
      expect(readRepoFile(fixture.path, 'a.txt')).toBe('main a\n')
      expect(readRepoFile(fixture.path, 'b.txt')).toBe('feature b\n')
    })
  })

  it(
    'finishes a revert whose result is already in HEAD',
    async () => {
      await withConflictedRepo(
        'revert',
        async (fixture) => {
          const headBefore = gitOutput(fixture.path, ['rev-parse', 'HEAD']).trim()
          await runOp(resolveConflict(fixture.path, 'f.txt', 'ours'))

          await withoutAmbientEditors(() => runOp(continueOperation(fixture.path)))

          expect(gitOutput(fixture.path, ['rev-parse', 'HEAD']).trim()).toBe(headBefore)
          expect(porcelain(fixture.path)).toBe('')
          expect(await currentOperationKind(fixture.path)).toBeUndefined()
        },
        { config: { 'core.editor': BLOCKING_EDITOR } }
      )
    },
    EDITOR_TIMEOUT_MS
  )

  it(
    'finishes a rebase whose only commit resolves to the branch it replays onto',
    async () => {
      await withConflictedRepo(
        'rebase',
        async (fixture) => {
          await runOp(resolveConflict(fixture.path, 'f.txt', 'ours'))

          await withoutAmbientEditors(() => runOp(continueOperation(fixture.path)))

          expect(gitOutput(fixture.path, ['rev-parse', 'HEAD']).trim()).toBe(
            gitOutput(fixture.path, ['rev-parse', 'main']).trim()
          )
          expect(gitOutput(fixture.path, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe(
            'feature'
          )
          expect(porcelain(fixture.path)).toBe('')
          expect(await currentOperationKind(fixture.path)).toBeUndefined()
        },
        { config: { 'core.editor': BLOCKING_EDITOR } }
      )
    },
    EDITOR_TIMEOUT_MS
  )

  it.skipIf(!supportsRebaseApplyBackend())(
    'finishes a rebase-apply whose only commit resolves to the branch it replays onto',
    async () => {
      await withConflictedRepo(
        'rebase-apply',
        async (fixture) => {
          await runOp(resolveConflict(fixture.path, 'f.txt', 'ours'))

          await withoutAmbientEditors(() => runOp(continueOperation(fixture.path)))

          expect(gitOutput(fixture.path, ['rev-parse', 'HEAD']).trim()).toBe(
            gitOutput(fixture.path, ['rev-parse', 'main']).trim()
          )
          expect(porcelain(fixture.path)).toBe('')
          expect(await currentOperationKind(fixture.path)).toBeUndefined()
        },
        { config: { 'core.editor': BLOCKING_EDITOR } }
      )
    },
    EDITOR_TIMEOUT_MS
  )
})

describe('resolveConflict', () => {
  // Every case below has to start from a genuinely conflicted index, or "no conflicts left"
  // afterwards proves nothing.
  function expectConflicted(repo: string, file: string): void {
    expect(indexStages(repo, file).filter((stage) => stage > 0).length).toBeGreaterThan(0)
  }

  it('takes our side of a both-modified file and stages it', async () => {
    await withConflictedRepo('merge', async (fixture) => {
      expectConflicted(fixture.path, 'f.txt')

      await runOp(resolveConflict(fixture.path, 'f.txt', 'ours'))

      expect(readRepoFile(fixture.path, 'f.txt')).toBe('main\n')
      expect(conflictedPaths(fixture.path)).toEqual([])
      expect(indexStages(fixture.path, 'f.txt')).toEqual([0])
    })
  })

  it('takes their side of a both-modified file and stages it', async () => {
    await withConflictedRepo('merge', async (fixture) => {
      expectConflicted(fixture.path, 'f.txt')

      await runOp(resolveConflict(fixture.path, 'f.txt', 'theirs'))

      expect(readRepoFile(fixture.path, 'f.txt')).toBe('feature\n')
      expect(conflictedPaths(fixture.path)).toEqual([])
      expect(indexStages(fixture.path, 'f.txt')).toEqual([0])
      expect(stagedEntry(fixture.path, 'f.txt')).toBe('M ')
    })
  })

  it('resolves a both-added file from either side', async () => {
    for (const { side, contents } of [
      { side: 'ours' as const, contents: 'from main\n' },
      { side: 'theirs' as const, contents: 'from feature\n' }
    ]) {
      await withConflictedRepo('merge-both-added', async (fixture) => {
        expectConflicted(fixture.path, 'added.txt')

        await runOp(resolveConflict(fixture.path, 'added.txt', side))

        expect(readRepoFile(fixture.path, 'added.txt')).toBe(contents)
        expect(indexStages(fixture.path, 'added.txt')).toEqual([0])
        expect(conflictedPaths(fixture.path)).toEqual([])
      })
    }
  })

  it('keeps the file when the chosen side still has it in a modify/delete conflict', async () => {
    await withConflictedRepo('modify-delete', async (fixture) => {
      expect(conflictedPaths(fixture.path)).toEqual(['ours-kept.txt', 'theirs-kept.txt'])

      await runOp(resolveConflict(fixture.path, 'ours-kept.txt', 'ours'))

      expect(readRepoFile(fixture.path, 'ours-kept.txt')).toBe('main\n')
      expect(conflictedPaths(fixture.path)).toEqual(['theirs-kept.txt'])
    })
  })

  it('deletes the file when the chosen side deleted it in a modify/delete conflict', async () => {
    await withConflictedRepo('modify-delete', async (fixture) => {
      expect(conflictedPaths(fixture.path)).toEqual(['ours-kept.txt', 'theirs-kept.txt'])

      await runOp(resolveConflict(fixture.path, 'ours-kept.txt', 'theirs'))

      expect(fs.existsSync(path.join(fixture.path, 'ours-kept.txt'))).toBe(false)
      expect(stagedEntry(fixture.path, 'ours-kept.txt')).toBe('D ')
      expect(conflictedPaths(fixture.path)).toEqual(['theirs-kept.txt'])
    })
  })

  it('deletes the file when our side deleted it in a delete/modify conflict', async () => {
    await withConflictedRepo('modify-delete', async (fixture) => {
      expect(conflictedPaths(fixture.path)).toEqual(['ours-kept.txt', 'theirs-kept.txt'])

      await runOp(resolveConflict(fixture.path, 'theirs-kept.txt', 'ours'))

      expect(fs.existsSync(path.join(fixture.path, 'theirs-kept.txt'))).toBe(false)
      expect(conflictedPaths(fixture.path)).toEqual(['ours-kept.txt'])
    })
  })

  it('resolves a both-deleted path with either side', async () => {
    // Neither side kept a blob at the path, so both choices have to mean the same thing — and
    // `theirs` is the one with no stage to check out, which is where a wrong turn would show.
    for (const side of ['ours', 'theirs'] as const) {
      await withConflictedRepo('rename-rename', async (fixture) => {
        expect(gitOutput(fixture.path, ['status', '--porcelain'])).toContain('DD f.txt')
        expectConflicted(fixture.path, 'f.txt')

        await runOp(resolveConflict(fixture.path, 'f.txt', side))

        expect(fs.existsSync(path.join(fixture.path, 'f.txt'))).toBe(false)
        expect(gitOutput(fixture.path, ['ls-files', '-u', '--', 'f.txt']).trim()).toBe('')
      })
    }
  })

  it('resolves a binary conflict byte-for-byte', async () => {
    await withConflictedRepo('binary', async (fixture) => {
      expectConflicted(fixture.path, 'image.bin')

      await runOp(resolveConflict(fixture.path, 'image.bin', 'theirs'))

      const bytes = fs.readFileSync(path.join(fixture.path, 'image.bin'))
      expect([...bytes]).toEqual([0, 1, 2, 0, 3, 4])
      expect(conflictedPaths(fixture.path)).toEqual([])
    })
  })

  it('resolves each side of a rebase using the same stage numbers', async () => {
    // Mid-rebase stage :2 is `main` (the branch rebased onto) and stage :3 is `feature` — the
    // reverse of what the branch names suggest, which is exactly why both sides are checked.
    for (const { side, contents } of [
      { side: 'ours' as const, contents: 'main\n' },
      { side: 'theirs' as const, contents: 'feature\n' }
    ]) {
      await withConflictedRepo('rebase', async (fixture) => {
        expectConflicted(fixture.path, 'f.txt')

        await runOp(resolveConflict(fixture.path, 'f.txt', side))

        expect(readRepoFile(fixture.path, 'f.txt')).toBe(contents)
        expect(conflictedPaths(fixture.path)).toEqual([])
      })
    }
  })

  it('fails for a file that has no conflict stages', async () => {
    await withConflictedRepo('merge', async (fixture) => {
      writeRepoFile(fixture.path, 'clean.txt', 'clean\n')
      const result = await runOp(Effect.either(resolveConflict(fixture.path, 'clean.txt', 'ours')))
      expect(Either.isLeft(result)).toBe(true)
      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe('GitError')
        expect((result.left as { message: string }).message).toMatch(/conflict/i)
      }
    })
  })
})

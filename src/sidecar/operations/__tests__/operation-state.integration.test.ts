import fs from 'node:fs'
import path from 'node:path'
import type { OperationState } from '@shared/schemas/git'
import { describe, expect, it } from 'vitest'
import {
  type ConflictedRepo,
  type ConflictFixtureKind,
  type ConflictFixtureOptions,
  git,
  gitOutput,
  makeConflictedRepo,
  removeRepoDir,
  supportsRebaseApplyBackend,
  writeRepoFile
} from '../../test-support/repo-fixtures'
import { runOp } from '../../test-support/run-op'
import { closeRepo, getStatus, openRepo } from '../index'
import { detectOperationState } from '../operation-state'

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

async function readOperation(repoPath: string): Promise<OperationState> {
  const { status } = await runOp(getStatus(repoPath))
  if (!status.operation) {
    throw new Error('expected an operation in progress')
  }
  return status.operation
}

describe('operation detection', () => {
  it('reports nothing when no operation is in progress', async () => {
    await withConflictedRepo('merge', async (fixture) => {
      git(fixture.path, ['merge', '--abort'])
      const { status } = await runOp(getStatus(fixture.path))
      expect(status.operation).toBeUndefined()
    })
  })

  it('reports a merge with both branch names and the prepared merge message', async () => {
    await withConflictedRepo('merge', async (fixture) => {
      const operation = await readOperation(fixture.path)
      expect(operation.kind).toBe('merge')
      expect(operation.oursLabel).toBe('main')
      expect(operation.theirsLabel).toBe('feature')
      expect(operation.mergeMessage).toContain("Merge branch 'feature'")
      expect(operation.done).toBeUndefined()
      expect(operation.total).toBeUndefined()
    })
  })

  // The one label pairing intuition gets backwards: mid-rebase, index stage :2 ("ours") holds the
  // branch being rebased ONTO, and stage :3 ("theirs") holds the branch being replayed.
  it('inverts the rebase labels: ours names the branch rebased onto', async () => {
    await withConflictedRepo('rebase', async (fixture) => {
      const operation = await readOperation(fixture.path)
      expect(operation.kind).toBe('rebase-merge')
      expect(operation.oursLabel).toBe('main')
      expect(operation.theirsLabel).toBe('feature')
      expect(operation.done).toBe(1)
      expect(operation.total).toBe(1)
      expect(operation.mergeMessage).toBeUndefined()
    })
  })

  // Every test guarded on this probe disappears silently if the probe starts answering false, so the
  // probe itself is asserted: `--apply` has been a rebase backend since git 2.26.
  it('probes the apply backend as available on this git', () => {
    expect(supportsRebaseApplyBackend()).toBe(true)
  })

  it.skipIf(!supportsRebaseApplyBackend())(
    'reports the apply backend as rebase-apply, not am',
    async () => {
      await withConflictedRepo('rebase-apply', async (fixture) => {
        const operation = await readOperation(fixture.path)
        expect(operation.kind).toBe('rebase-apply')
        expect(operation.oursLabel).toBe('main')
        expect(operation.theirsLabel).toBe('feature')
        expect(operation.done).toBe(1)
        expect(operation.total).toBe(1)
      })
    }
  )

  it('reports an am that shares the rebase-apply directory as am', async () => {
    await withConflictedRepo('am', async (fixture) => {
      const operation = await readOperation(fixture.path)
      expect(operation.kind).toBe('am')
      expect(operation.oursLabel).toBe('main')
      expect(operation.theirsLabel).toContain('feature work')
      expect(operation.done).toBe(1)
      expect(operation.total).toBe(1)
    })
  })

  // Stage :3 of a revert holds the *parent* of the reverted commit — the state git is restoring, not
  // the commit being undone. Labelling it with that commit would make "Keep <it>" mean the opposite
  // of what it says, so the label names the revert itself.
  it('labels a single-commit revert as the revert rather than the commit it undoes', async () => {
    await withConflictedRepo('revert', async (fixture) => {
      const revertedSha = gitOutput(fixture.path, ['rev-parse', '--short', 'HEAD~1']).trim()
      const operation = await readOperation(fixture.path)
      expect(operation.kind).toBe('revert')
      expect(operation.oursLabel).toBe('main')
      expect(operation.theirsLabel).toMatch(/^revert of /)
      expect(operation.theirsLabel).toContain(revertedSha)
      expect(operation.theirsLabel).toContain('two')
      expect(operation.done).toBeUndefined()
      // What the label stands for: undoing 'two' restores what 'one' left behind.
      expect(gitOutput(fixture.path, ['cat-file', '-p', ':3:f.txt'])).toBe('one\n')
    })
  })

  it('labels the step of a revert sequence as the revert too', async () => {
    await withConflictedRepo('revert-sequence', async (fixture) => {
      const operation = await readOperation(fixture.path)
      expect(operation.kind).toBe('revert')
      expect(operation.oursLabel).toBe('main')
      expect(operation.theirsLabel).toMatch(/^revert of /)
      expect(operation.theirsLabel).toContain('two')
      expect(operation.total).toBe(2)
      expect(gitOutput(fixture.path, ['cat-file', '-p', ':3:f.txt'])).toBe('one\n')
    })
  })

  it('counts a multi-commit cherry-pick sequence as it advances', async () => {
    await withConflictedRepo('cherry-pick-sequence', async (fixture) => {
      const first = await readOperation(fixture.path)
      expect(first.kind).toBe('cherry-pick')
      expect(first.oursLabel).toBe('main')
      expect(first.theirsLabel).toContain('feature edits a')
      expect(first.done).toBe(1)
      expect(first.total).toBe(2)

      writeRepoFile(fixture.path, 'a.txt', 'resolved a\n')
      git(fixture.path, ['add', '--', 'a.txt'])
      // The second pick conflicts too, so git exits non-zero: that is the state under test.
      try {
        git(fixture.path, ['-c', 'core.editor=true', 'cherry-pick', '--continue'])
      } catch {}

      const second = await readOperation(fixture.path)
      expect(second.kind).toBe('cherry-pick')
      expect(second.theirsLabel).toContain('feature edits b')
      expect(second.done).toBe(2)
      expect(second.total).toBe(2)
    })
  })

  it('strips the Conflicts block under a repo-configured comment character', async () => {
    await withConflictedRepo(
      'merge',
      async (fixture) => {
        expect(fs.readFileSync(path.join(fixture.path, '.git', 'MERGE_MSG'), 'utf8')).toContain(
          '; Conflicts:'
        )

        const operation = await readOperation(fixture.path)
        expect(operation.mergeMessage).toBe("Merge branch 'feature'")
      },
      { config: { 'core.commentChar': ';' } }
    )
  })

  it('labels a detached HEAD by short sha rather than a branch name', async () => {
    await withConflictedRepo('merge', async (fixture) => {
      git(fixture.path, ['merge', '--abort'])
      git(fixture.path, ['checkout', '--detach', 'main'])
      const detachedSha = gitOutput(fixture.path, ['rev-parse', '--short=7', 'HEAD']).trim()
      try {
        git(fixture.path, ['merge', '--no-edit', 'feature'])
      } catch {}

      const operation = await readOperation(fixture.path)
      expect(operation.kind).toBe('merge')
      expect(operation.oursLabel).toBe(detachedSha)
      expect(operation.theirsLabel).toBe('feature')
    })
  })
})

// An external `--quit`/`--abort` can unlink a state directory between the check that it exists and
// the reads of the files inside it. A state built entirely from failed reads is not an operation.
describe('operation detection — state directory emptied mid-read', () => {
  async function withEmptiedStateDir<T>(
    stateDir: string,
    files: Record<string, string>,
    use: (repoPath: string) => Promise<T>
  ): Promise<T> {
    const fixture = makeConflictedRepo('merge')
    try {
      git(fixture.path, ['merge', '--abort'])
      const dir = path.join(fixture.path, '.git', stateDir)
      fs.mkdirSync(dir)
      for (const [name, contents] of Object.entries(files)) {
        fs.writeFileSync(path.join(dir, name), contents)
      }
      return await use(fixture.path)
    } finally {
      removeRepoDir(fixture.path)
    }
  }

  it('reports no rebase for a rebase-merge directory with nothing identifying left', async () => {
    await withEmptiedStateDir('rebase-merge', {}, async (repoPath) => {
      expect(await detectOperationState(repoPath)).toBeUndefined()
    })
  })

  it('reports no rebase for a rebase-apply directory with nothing identifying left', async () => {
    await withEmptiedStateDir('rebase-apply', {}, async (repoPath) => {
      expect(await detectOperationState(repoPath)).toBeUndefined()
    })
  })

  it('reports no patch series for an am directory with nothing but its marker left', async () => {
    await withEmptiedStateDir('rebase-apply', { applying: '' }, async (repoPath) => {
      expect(await detectOperationState(repoPath)).toBeUndefined()
    })
  })
})

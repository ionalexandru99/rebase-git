import { parseUnifiedDiff } from '@shared/unified-diff'
import { Effect, Either } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRepoFixture, type RepoFixture } from '../../test-support/repo-fixtures'
import { runOp } from '../../test-support/run-op'
import {
  closeRepo,
  getDiff,
  getStatus,
  openRepo,
  stageHunk,
  unstageFile,
  unstageHunk
} from '../index'

const hunksOf = (result: { patch: string }) => parseUnifiedDiff(result.patch).hunks
let repoDir: string
let repo: RepoFixture

const baseLines = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`)

beforeAll(async () => {
  repo = createRepoFixture({ prefix: 'rebase-diff-test-' })
  repoDir = repo.path
  repo.writeLines('sample.txt', baseLines)
  repo.git('add', '.')
  repo.commitStaged('base')

  await runOp(openRepo(repoDir))
})

afterAll(async () => {
  await runOp(closeRepo(repoDir))
  repo.cleanup()
})

describe('diff operations against a real repository', () => {
  it('stages a single hunk and leaves the other unstaged', async () => {
    const edited = [...baseLines]
    edited[0] = 'line 1 EDITED'
    edited[35] = 'line 36 EDITED'
    repo.writeLines('sample.txt', edited)

    const unstaged = await runOp(getDiff(repoDir, 'sample.txt', false))
    expect(hunksOf(unstaged)).toHaveLength(2)

    const firstHeader = hunksOf(unstaged)[0].header
    await runOp(stageHunk(repoDir, 'sample.txt', firstHeader))

    const stagedAfter = await runOp(getDiff(repoDir, 'sample.txt', true))
    expect(hunksOf(stagedAfter)).toHaveLength(1)
    expect(hunksOf(stagedAfter)[0].lines.some((line) => line.text === 'line 1 EDITED')).toBe(true)

    const unstagedAfter = await runOp(getDiff(repoDir, 'sample.txt', false))
    expect(hunksOf(unstagedAfter)).toHaveLength(1)
    expect(hunksOf(unstagedAfter)[0].lines.some((line) => line.text === 'line 36 EDITED')).toBe(
      true
    )
  })

  it('unstages a staged hunk back to the working tree', async () => {
    const staged = await runOp(getDiff(repoDir, 'sample.txt', true))
    expect(hunksOf(staged)).toHaveLength(1)

    await runOp(unstageHunk(repoDir, 'sample.txt', hunksOf(staged)[0].header))

    const stagedAfter = await runOp(getDiff(repoDir, 'sample.txt', true))
    expect(hunksOf(stagedAfter)).toHaveLength(0)

    const unstagedAfter = await runOp(getDiff(repoDir, 'sample.txt', false))
    expect(hunksOf(unstagedAfter)).toHaveLength(2)
  })

  it('reports a fully staged file once every hunk is staged individually', async () => {
    const unstaged = await runOp(getDiff(repoDir, 'sample.txt', false))
    expect(hunksOf(unstaged)).toHaveLength(2)

    for (const hunk of hunksOf(unstaged)) {
      const refreshed = await runOp(getDiff(repoDir, 'sample.txt', false))
      const liveHunk = hunksOf(refreshed).find((candidate) =>
        candidate.lines.some((line) => hunk.lines.some((other) => other.text === line.text))
      )
      expect(liveHunk).toBeDefined()
      if (!liveHunk) {
        return
      }
      await runOp(stageHunk(repoDir, 'sample.txt', liveHunk.header))
    }

    const status = await runOp(getStatus(repoDir))
    const entry = status.status.files?.find((candidate) => candidate.path === 'sample.txt')
    expect(entry).toEqual({ path: 'sample.txt', index: 'M', working_dir: ' ' })

    repo.git('reset', 'HEAD', 'sample.txt')
  })

  it('returns HunkNotFound for a stale hunk header', async () => {
    const result = await runOp(
      Effect.either(stageHunk(repoDir, 'sample.txt', '@@ -999,1 +999,1 @@'))
    )
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('HunkNotFound')
    }
  })

  it('produces a synthetic diff for untracked files', async () => {
    repo.writeLines('brand-new.txt', ['alpha', 'beta'])

    const diff = await runOp(getDiff(repoDir, 'brand-new.txt', false))
    expect(hunksOf(diff)).toHaveLength(1)
    expect(hunksOf(diff)[0].lines.map((line) => line.text)).toEqual(['alpha', 'beta'])
    expect(hunksOf(diff)[0].lines.every((line) => line.kind === 'add')).toBe(true)
  })

  it('produces a synthetic diff for an untracked unicode-named file', async () => {
    repo.writeLines('café.txt', ['gamma', 'delta'])

    const diff = await runOp(getDiff(repoDir, 'café.txt', false))
    expect(hunksOf(diff)).toHaveLength(1)
    expect(hunksOf(diff)[0].lines.map((line) => line.text)).toEqual(['gamma', 'delta'])
    expect(hunksOf(diff)[0].lines.every((line) => line.kind === 'add')).toBe(true)
  })

  it('returns an empty diff for a clean tracked file', async () => {
    repo.git('checkout', '--', 'sample.txt')
    repo.git('reset', 'HEAD', 'sample.txt')
    repo.git('checkout', '--', 'sample.txt')

    const diff = await runOp(getDiff(repoDir, 'sample.txt', false))
    expect(hunksOf(diff)).toHaveLength(0)
  })

  it('unstages an option-like filename as a path, never as a flag', async () => {
    const canary = 'reset-canary.txt'
    repo.write(canary, 'committed\n')
    repo.git('add', '--', canary)
    repo.commitStaged('add reset canary')
    repo.write(canary, 'uncommitted edit\n')

    const optionLikeName = '--hard'
    repo.write(optionLikeName, 'staged\n')
    repo.git('add', '--', optionLikeName)

    await runOp(unstageFile(repoDir, optionLikeName))

    expect(repo.git('diff', '--cached', '--name-only')).not.toContain(optionLikeName)
    expect(repo.read(canary)).toBe('uncommitted edit\n')

    repo.removeFile(optionLikeName)
    repo.git('checkout', '--', canary)
  })

  it('returns displayable hunks for an unresolved merge conflict', async () => {
    repo.write('conflict.txt', 'base\n')
    repo.git('add', 'conflict.txt')
    repo.commitStaged('conflict base')
    repo.git('checkout', '-b', 'conflict-side')
    repo.write('conflict.txt', 'side\n')
    repo.git('commit', '-am', 'side change')
    repo.git('checkout', 'main')
    repo.write('conflict.txt', 'main\n')
    repo.git('commit', '-am', 'main change')
    expect(() => repo.git('merge', 'conflict-side')).toThrow()

    try {
      const diff = await runOp(getDiff(repoDir, 'conflict.txt', false))
      expect(hunksOf(diff).length).toBeGreaterThan(0)
      expect(hunksOf(diff).flatMap((hunk) => hunk.lines).length).toBeGreaterThan(0)
    } finally {
      repo.git('merge', '--abort')
    }
  })
})

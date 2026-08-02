import { GIT_EMPTY_TREE_OID } from '@shared/git-constants'
import { parseUnifiedDiff } from '@shared/unified-diff'
import { Effect, Either } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRepoFixture, type RepoFixture } from '../../test-support/repo-fixtures'
import { runOp } from '../../test-support/run-op'
import { closeRepo, getDiff, openRepo } from '../index'

const hunksOf = (result: { patch: string }) => parseUnifiedDiff(result.patch).hunks
let repoDir: string
let repo: RepoFixture

const baseLines = Array.from({ length: 8 }, (_, index) => `line ${index + 1}`)

beforeAll(async () => {
  repo = createRepoFixture({ prefix: 'rebase-diff-range-' })
  repoDir = repo.path

  repo.writeLines('sample.txt', baseLines)
  repo.git('add', '.')
  repo.commitStaged('base')

  const edited = [...baseLines]
  edited[0] = 'line 1 EDITED'
  repo.writeLines('sample.txt', edited)
  repo.git('add', '.')
  repo.commitStaged('edit line 1')

  await runOp(openRepo(repoDir))
})

afterAll(async () => {
  await runOp(closeRepo(repoDir))
  repo.cleanup()
})

describe('getDiff with a commit range', () => {
  it("shows a committed file's change across HEAD~1..HEAD", async () => {
    const diff = await runOp(getDiff(repoDir, 'sample.txt', false, { range: 'HEAD~1..HEAD' }))

    expect(hunksOf(diff)).toHaveLength(1)
    expect(hunksOf(diff)[0].lines.some((line) => line.text === 'line 1 EDITED')).toBe(true)
  })

  it('lists a root commit as all additions against the empty tree', async () => {
    const diff = await runOp(
      getDiff(repoDir, 'sample.txt', false, { range: `${GIT_EMPTY_TREE_OID}..HEAD~1` })
    )

    expect(hunksOf(diff)).toHaveLength(1)
    const added = hunksOf(diff)[0].lines.filter((line) => line.kind === 'add')
    expect(added.map((line) => line.text)).toEqual(baseLines)
  })

  it('still produces the synthetic untracked diff when no range is given', async () => {
    repo.writeLines('fresh.txt', ['alpha', 'beta'])

    const diff = await runOp(getDiff(repoDir, 'fresh.txt', false))

    expect(hunksOf(diff)).toHaveLength(1)
    expect(hunksOf(diff)[0].lines.map((line) => line.text)).toEqual(['alpha', 'beta'])
    expect(hunksOf(diff)[0].lines.every((line) => line.kind === 'add')).toBe(true)

    repo.removeFile('fresh.txt')
  })

  it('rejects an option-like range as a GitError', async () => {
    const result = await runOp(
      Effect.either(getDiff(repoDir, 'sample.txt', false, { range: '--output=/tmp/pwned' }))
    )

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('GitError')
    }
  })
})

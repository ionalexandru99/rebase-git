import { MAX_COMMIT_STATS_BATCH } from '@shared/git-constants'
import { Effect, Either } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRepoFixture, type RepoFixture } from '../../test-support/repo-fixtures'
import { runOp } from '../../test-support/run-op'
import { closeRepo, getCommitStats, openRepo } from '../index'

let repoDir: string
let repo: RepoFixture
const sha: Record<string, string> = {}

beforeAll(async () => {
  repo = createRepoFixture({
    prefix: 'rebase-commit-stats-',
    userEmail: 'author@example.com',
    userName: 'Ada Author'
  })
  repoDir = repo.path

  repo.write('one.txt', 'a\nb\nc\n')
  repo.write('two.txt', 'x\n')
  repo.git('add', '-A')
  sha.root = repo.commitStaged('root commit')

  repo.write('one.txt', 'a\nB\nc\nd\n')
  repo.write('two.txt', 'y\nz\n')
  repo.write('logo.png', Buffer.from([0, 1, 2, 3, 0, 255]))
  repo.git('add', '-A')
  sha.second = repo.commitStaged('second commit')

  repo.git('checkout', '-q', '-b', 'side', sha.root)
  repo.write('side.txt', 'from\nthe\nside\n')
  repo.git('add', '-A')
  sha.side = repo.commitStaged('side commit')

  repo.git('checkout', '-q', 'main')
  repo.git(
    '-c',
    'commit.gpgsign=false',
    'merge',
    '--no-ff',
    '--no-edit',
    '-m',
    'Merge side into main',
    'side'
  )
  sha.merge = repo.head()

  await runOp(openRepo(repoDir))
})

afterAll(async () => {
  await runOp(closeRepo(repoDir))
  repo.cleanup()
})

describe('getCommitStats', () => {
  it('totals additions and deletions across a commit, counting a binary file as zero', async () => {
    const { stats } = await runOp(getCommitStats(repoDir, [sha.second]))

    expect(stats).toEqual([{ sha: sha.second, additions: 4, deletions: 2 }])
  })

  it('counts a root commit against the empty tree', async () => {
    const { stats } = await runOp(getCommitStats(repoDir, [sha.root]))

    expect(stats).toEqual([{ sha: sha.root, additions: 4, deletions: 0 }])
  })

  it('skips a sha that does not resolve instead of failing the whole batch', async () => {
    const { stats } = await runOp(
      getCommitStats(repoDir, [sha.second, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', sha.root])
    )

    expect(stats).toEqual([
      { sha: sha.second, additions: 4, deletions: 2 },
      { sha: sha.root, additions: 4, deletions: 0 }
    ])
  })

  it('measures a merge commit against its first parent', async () => {
    const { stats } = await runOp(getCommitStats(repoDir, [sha.merge]))

    expect(stats).toEqual([{ sha: sha.merge, additions: 3, deletions: 0 }])
  })

  it('returns nothing for an empty batch', async () => {
    const { stats } = await runOp(getCommitStats(repoDir, []))

    expect(stats).toEqual([])
  })

  it('rejects an option-like sha as a GitError', async () => {
    const result = await runOp(
      Effect.either(getCommitStats(repoDir, [sha.second, '--output=/tmp/pwned']))
    )

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('GitError')
      expect(result.left.message).toContain('unsafe commit')
    }
  })

  it('rejects a batch larger than the cap', async () => {
    const oversized = Array.from({ length: MAX_COMMIT_STATS_BATCH + 1 }, () => sha.second)

    const result = await runOp(Effect.either(getCommitStats(repoDir, oversized)))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('GitError')
    }
  })
})

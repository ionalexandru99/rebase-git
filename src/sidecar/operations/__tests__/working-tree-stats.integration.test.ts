import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRepoFixture, type RepoFixture } from '../../test-support/repo-fixtures'
import { runOp } from '../../test-support/run-op'
import { closeRepo, getWorkingTreeStats, openRepo } from '../index'

let repoDir: string
let repo: RepoFixture

beforeAll(async () => {
  repo = createRepoFixture({
    prefix: 'rebase-worktree-stats-',
    userEmail: 'author@example.com',
    userName: 'Ada Author'
  })
  repoDir = repo.path

  repo.write('one.txt', 'a\nb\nc\n')
  repo.write('two.txt', 'x\ny\n')
  repo.git('add', '-A')
  repo.commitStaged('root commit')

  await runOp(openRepo(repoDir))
})

afterAll(async () => {
  await runOp(closeRepo(repoDir))
  repo.cleanup()
})

describe('getWorkingTreeStats', () => {
  it('reports zeros for a clean tree', async () => {
    const stats = await runOp(getWorkingTreeStats(repoDir))

    expect(stats).toEqual({ additions: 0, deletions: 0 })
  })

  it('totals tracked and untracked changes against HEAD', async () => {
    repo.write('one.txt', 'a\nB\nc\nd\ne\n')
    repo.write('two.txt', 'x\n')
    repo.write('untracked.txt', 'p\nq\nr\n')

    const stats = await runOp(getWorkingTreeStats(repoDir))

    expect(stats).toEqual({ additions: 6, deletions: 2 })
  })

  it('keeps the same totals once part of the change is staged', async () => {
    repo.git('add', '--', 'one.txt')

    const stats = await runOp(getWorkingTreeStats(repoDir))

    expect(stats).toEqual({ additions: 6, deletions: 2 })
  })

  it('counts staged files against the empty tree while HEAD is still unborn', async () => {
    const unbornRepo = createRepoFixture({ prefix: 'rebase-worktree-stats-unborn-' })
    unbornRepo.write('fresh.txt', 'a\nb\n')
    unbornRepo.git('add', '-A')
    await runOp(openRepo(unbornRepo.path))

    try {
      const stats = await runOp(getWorkingTreeStats(unbornRepo.path))

      expect(stats).toEqual({ additions: 2, deletions: 0 })
    } finally {
      await runOp(closeRepo(unbornRepo.path))
      unbornRepo.cleanup()
    }
  })
})

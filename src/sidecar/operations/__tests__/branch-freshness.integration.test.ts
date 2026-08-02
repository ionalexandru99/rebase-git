import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRepoFixture, type RepoFixture } from '../../test-support/repo-fixtures'
import { runOp } from '../../test-support/run-op'
import { closeRepo, getLocalBranches, openRepo } from '../index'

const MAIN_COMMITTED_AT = '2022-06-07T08:09:10+00:00'
const FEATURE_COMMITTED_AT = '2021-01-02T03:04:05+00:00'

let repo: RepoFixture

function git(args: string[], committerDate?: string): string {
  return execFileSync('git', ['-C', repo.path, ...args], {
    encoding: 'utf8',
    env: committerDate ? { ...process.env, GIT_COMMITTER_DATE: committerDate } : process.env
  })
}

function commit(message: string, committedAt: string): void {
  git(['-c', 'commit.gpgsign=false', 'commit', '--no-gpg-sign', '-m', message], committedAt)
}

beforeAll(async () => {
  repo = createRepoFixture({
    prefix: 'rebase-branch-freshness-',
    userEmail: 'author@example.com',
    userName: 'Ada Author'
  })

  repo.write('one.txt', 'a\n')
  git(['add', '-A'])
  commit('main commit', MAIN_COMMITTED_AT)

  git(['checkout', '-q', '-b', 'feature'])
  repo.write('two.txt', 'b\n')
  git(['add', '-A'])
  commit('feature commit', FEATURE_COMMITTED_AT)

  git(['checkout', '-q', 'main'])

  await runOp(openRepo(repo.path))
})

afterAll(async () => {
  await runOp(closeRepo(repo.path))
  repo.cleanup()
})

describe('local branch freshness', () => {
  it('carries the tip committer date of every branch as an ISO string', async () => {
    const { branches } = await runOp(getLocalBranches(repo.path))

    expect(Object.keys(branches.lastCommitAt ?? {}).sort()).toEqual(['feature', 'main'])
    expect(Date.parse(branches.lastCommitAt?.main ?? '')).toBe(Date.parse(MAIN_COMMITTED_AT))
    expect(Date.parse(branches.lastCommitAt?.feature ?? '')).toBe(Date.parse(FEATURE_COMMITTED_AT))
  })

  it('orders branches by their tip committer date', async () => {
    const { branches } = await runOp(getLocalBranches(repo.path))
    const lastCommitAt = branches.lastCommitAt ?? {}

    const freshestFirst = [...branches.all].sort(
      (left, right) => Date.parse(lastCommitAt[right] ?? '') - Date.parse(lastCommitAt[left] ?? '')
    )

    expect(branches.all).toEqual(['feature', 'main'])
    expect(freshestFirst).toEqual(['main', 'feature'])
  })
})

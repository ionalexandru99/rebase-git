import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRepoFixture, type RepoFixture } from '../../test-support/repo-fixtures'
import { runOp } from '../../test-support/run-op'
import { closeRepo, openRepo, stashList } from '../index'

const OLDER_STASHED_AT = '2021-01-02T03:04:05+00:00'
const NEWER_STASHED_AT = '2022-06-07T08:09:10+00:00'

let repo: RepoFixture

function git(args: string[], committerDate?: string): string {
  return execFileSync('git', ['-C', repo.path, ...args], {
    encoding: 'utf8',
    env: committerDate ? { ...process.env, GIT_COMMITTER_DATE: committerDate } : process.env
  })
}

beforeAll(async () => {
  repo = createRepoFixture({
    prefix: 'rebase-stash-freshness-',
    userEmail: 'author@example.com',
    userName: 'Ada Author'
  })

  repo.write('file.txt', 'base\n')
  git(['add', '-A'])
  git(['-c', 'commit.gpgsign=false', 'commit', '--no-gpg-sign', '-m', 'base'])

  repo.write('file.txt', 'older change\n')
  git(['stash', 'push', '-m', 'older work'], OLDER_STASHED_AT)

  repo.write('file.txt', 'newer change\n')
  git(['stash', 'push', '-m', 'newer work'], NEWER_STASHED_AT)

  await runOp(openRepo(repo.path))
})

afterAll(async () => {
  await runOp(closeRepo(repo.path))
  repo.cleanup()
})

describe('stash freshness', () => {
  it('carries the committer date of every stash entry as an ISO string', async () => {
    const { stashes } = await runOp(stashList(repo.path))

    expect(stashes.map((stash) => stash.message)).toEqual(['newer work', 'older work'])
    expect(Date.parse(stashes[0].lastCommitAt ?? '')).toBe(Date.parse(NEWER_STASHED_AT))
    expect(Date.parse(stashes[1].lastCommitAt ?? '')).toBe(Date.parse(OLDER_STASHED_AT))
  })
})

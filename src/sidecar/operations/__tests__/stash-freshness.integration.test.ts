import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runOp } from '../../test-support/run-op'
import { closeRepo, openRepo, stashList } from '../index'

const OLDER_STASHED_AT = '2021-01-02T03:04:05+00:00'
const NEWER_STASHED_AT = '2022-06-07T08:09:10+00:00'

let repoDir: string

function git(args: string[], committerDate?: string): string {
  return execFileSync('git', ['-C', repoDir, ...args], {
    encoding: 'utf8',
    env: committerDate ? { ...process.env, GIT_COMMITTER_DATE: committerDate } : process.env
  })
}

beforeAll(async () => {
  repoDir = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-stash-freshness-'))
  )
  git(['init', '-b', 'main'])
  git(['config', 'user.email', 'author@example.com'])
  git(['config', 'user.name', 'Ada Author'])

  fs.writeFileSync(path.join(repoDir, 'file.txt'), 'base\n')
  git(['add', '-A'])
  git(['-c', 'commit.gpgsign=false', 'commit', '--no-gpg-sign', '-m', 'base'])

  fs.writeFileSync(path.join(repoDir, 'file.txt'), 'older change\n')
  git(['stash', 'push', '-m', 'older work'], OLDER_STASHED_AT)

  fs.writeFileSync(path.join(repoDir, 'file.txt'), 'newer change\n')
  git(['stash', 'push', '-m', 'newer work'], NEWER_STASHED_AT)

  await runOp(openRepo(repoDir))
})

afterAll(async () => {
  await runOp(closeRepo(repoDir))
  fs.rmSync(repoDir, { recursive: true, force: true })
})

describe('stash freshness', () => {
  it('carries the committer date of every stash entry as an ISO string', async () => {
    const { stashes } = await runOp(stashList(repoDir))

    expect(stashes.map((stash) => stash.message)).toEqual(['newer work', 'older work'])
    expect(Date.parse(stashes[0].lastCommitAt ?? '')).toBe(Date.parse(NEWER_STASHED_AT))
    expect(Date.parse(stashes[1].lastCommitAt ?? '')).toBe(Date.parse(OLDER_STASHED_AT))
  })
})

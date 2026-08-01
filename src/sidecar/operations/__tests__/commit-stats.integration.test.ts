import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MAX_COMMIT_STATS_BATCH } from '@shared/git-constants'
import { Effect, Either } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runOp } from '../../test-support/run-op'
import { closeRepo, getCommitStats, openRepo } from '../index'

let repoDir: string
const sha: Record<string, string> = {}

function git(...args: string[]): string {
  return execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8' })
}

function commit(message: string): string {
  git('-c', 'commit.gpgsign=false', 'commit', '--no-gpg-sign', '-m', message)
  return git('rev-parse', 'HEAD').trim()
}

function write(file: string, contents: string): void {
  fs.writeFileSync(path.join(repoDir, file), contents)
}

beforeAll(async () => {
  repoDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-commit-stats-')))
  git('init', '-b', 'main')
  git('config', 'user.email', 'author@example.com')
  git('config', 'user.name', 'Ada Author')

  write('one.txt', 'a\nb\nc\n')
  write('two.txt', 'x\n')
  git('add', '-A')
  sha.root = commit('root commit')

  write('one.txt', 'a\nB\nc\nd\n')
  write('two.txt', 'y\nz\n')
  fs.writeFileSync(path.join(repoDir, 'logo.png'), Buffer.from([0, 1, 2, 3, 0, 255]))
  git('add', '-A')
  sha.second = commit('second commit')

  git('checkout', '-q', '-b', 'side', sha.root)
  write('side.txt', 'from\nthe\nside\n')
  git('add', '-A')
  sha.side = commit('side commit')

  git('checkout', '-q', 'main')
  git(
    '-c',
    'commit.gpgsign=false',
    'merge',
    '--no-ff',
    '--no-edit',
    '-m',
    'Merge side into main',
    'side'
  )
  sha.merge = git('rev-parse', 'HEAD').trim()

  await runOp(openRepo(repoDir))
})

afterAll(async () => {
  await runOp(closeRepo(repoDir))
  fs.rmSync(repoDir, { recursive: true, force: true })
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

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Effect, Either } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runOp } from '../../test-support/run-op'
import { closeRepo, getCommitDetail, getDiff, openRepo } from '../index'

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
  repoDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-commit-detail-')))
  git('init', '-b', 'main')
  git('config', 'user.email', 'author@example.com')
  git('config', 'user.name', 'Ada Author')

  write('one.txt', 'a\nb\nc\n')
  write('doomed.txt', 'gone\n')
  fs.writeFileSync(path.join(repoDir, 'logo.png'), Buffer.from([0, 1, 2, 3, 0, 255]))
  git('add', '-A')
  sha.root = commit('root commit')

  write('one.txt', 'a\nB\nc\n')
  write('added.txt', 'fresh\n')
  git('rm', '-q', 'doomed.txt')
  fs.mkdirSync(path.join(repoDir, 'assets'))
  git('mv', 'logo.png', 'assets/logo.png')
  git('add', '-A')
  sha.second = commit('second commit\n\nA body paragraph.\nAnd a second line.')

  git('checkout', '-q', '-b', 'side', sha.root)
  write('side.txt', 'from the side\n')
  git('add', '-A')
  sha.side = commit('side commit')

  git('checkout', '-q', 'main')
  git(
    '-c',
    'commit.gpgsign=false',
    '-c',
    'user.name=Cass Committer',
    '-c',
    'user.email=committer@example.com',
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

describe('getCommitDetail', () => {
  it('reports metadata, message body and the changed files of an ordinary commit', async () => {
    const { detail } = await runOp(getCommitDetail(repoDir, sha.second))

    expect(detail.sha).toBe(sha.second)
    expect(detail.parents).toEqual([sha.root])
    expect(detail.author).toEqual({ name: 'Ada Author', email: 'author@example.com' })
    expect(detail.subject).toBe('second commit')
    expect(detail.body).toBe('A body paragraph.\nAnd a second line.')
    expect(Date.parse(detail.authorDate)).not.toBeNaN()
    expect(detail.files).toEqual([
      { path: 'added.txt', status: 'A', additions: 1, deletions: 0, binary: false },
      {
        path: 'assets/logo.png',
        status: 'R',
        additions: 0,
        deletions: 0,
        binary: true,
        oldPath: 'logo.png'
      },
      { path: 'doomed.txt', status: 'D', additions: 0, deletions: 1, binary: false },
      { path: 'one.txt', status: 'M', additions: 1, deletions: 1, binary: false }
    ])
  })

  it('leaves the body empty when a commit has only a subject', async () => {
    const { detail } = await runOp(getCommitDetail(repoDir, sha.side))

    expect(detail.subject).toBe('side commit')
    expect(detail.body).toBe('')
  })

  it('lists every file as an addition for the root commit', async () => {
    const { detail } = await runOp(getCommitDetail(repoDir, sha.root))

    expect(detail.parents).toEqual([])
    expect(detail.files.map((file) => [file.path, file.status])).toEqual([
      ['doomed.txt', 'A'],
      ['logo.png', 'A'],
      ['one.txt', 'A']
    ])
  })

  it('reports a merge commit against its first parent and keeps both parents', async () => {
    const { detail } = await runOp(getCommitDetail(repoDir, sha.merge))

    expect(detail.parents).toEqual([sha.second, sha.side])
    expect(detail.files).toEqual([
      { path: 'side.txt', status: 'A', additions: 1, deletions: 0, binary: false }
    ])
  })

  it('rejects an option-like sha as a GitError', async () => {
    const result = await runOp(Effect.either(getCommitDetail(repoDir, '--output=/tmp/pwned')))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('GitError')
    }
  })

  it('fails with a GitError for a sha that does not resolve', async () => {
    const result = await runOp(Effect.either(getCommitDetail(repoDir, 'deadbee')))

    expect(Either.isLeft(result)).toBe(true)
  })
})

describe('getDiff for a commit', () => {
  it("returns a file's hunks for the commit versus its first parent", async () => {
    const { diff } = await runOp(getDiff(repoDir, 'one.txt', false, { commit: sha.second }))

    expect(diff.binary).toBe(false)
    expect(diff.hunks).toHaveLength(1)
    expect(
      diff.hunks[0].lines.filter((line) => line.kind === 'add').map((line) => line.text)
    ).toEqual(['B'])
    expect(
      diff.hunks[0].lines.filter((line) => line.kind === 'del').map((line) => line.text)
    ).toEqual(['b'])
  })

  it('shows a root commit file as all additions', async () => {
    const { diff } = await runOp(getDiff(repoDir, 'one.txt', false, { commit: sha.root }))

    expect(diff.hunks).toHaveLength(1)
    expect(diff.hunks[0].lines.map((line) => line.kind)).toEqual(['add', 'add', 'add'])
  })

  it('shows a deleted file as removals', async () => {
    const { diff } = await runOp(getDiff(repoDir, 'doomed.txt', false, { commit: sha.second }))

    expect(diff.hunks[0].lines.map((line) => [line.kind, line.text])).toEqual([['del', 'gone']])
  })

  it("diffs a merge against its first parent, so the side branch's file reads as added", async () => {
    const { diff } = await runOp(getDiff(repoDir, 'side.txt', false, { commit: sha.merge }))

    expect(diff.hunks).toHaveLength(1)
    expect(diff.hunks[0].lines.map((line) => [line.kind, line.text])).toEqual([
      ['add', 'from the side']
    ])
  })

  it('returns no hunks for a pure rename, which carries no content change', async () => {
    const { diff } = await runOp(
      getDiff(repoDir, 'assets/logo.png', false, {
        commit: sha.second,
        renameSource: 'logo.png'
      })
    )

    expect(diff.hunks).toEqual([])
  })

  it('flags an edited binary file instead of returning hunks', async () => {
    fs.writeFileSync(path.join(repoDir, 'assets/logo.png'), Buffer.from([9, 8, 7, 0, 6]))
    git('add', '-A')
    const binarySha = commit('touch up the logo')

    const { diff } = await runOp(getDiff(repoDir, 'assets/logo.png', false, { commit: binarySha }))

    expect(diff.binary).toBe(true)
    expect(diff.hunks).toEqual([])
  })

  it('reads a rename as a rename when given the old path alongside the new one', async () => {
    git('mv', 'one.txt', 'renamed.txt')
    write('renamed.txt', 'a\nB\nC\n')
    git('add', '-A')
    const renameSha = commit('rename and edit')

    const { diff } = await runOp(
      getDiff(repoDir, 'renamed.txt', false, { commit: renameSha, renameSource: 'one.txt' })
    )

    expect(diff.hunks).toHaveLength(1)
    expect(
      diff.hunks[0].lines.filter((line) => line.kind === 'add').map((line) => line.text)
    ).toEqual(['C'])
  })

  it('rejects an option-like commit as a GitError', async () => {
    const result = await runOp(
      Effect.either(getDiff(repoDir, 'one.txt', false, { commit: '--output=/tmp/pwned' }))
    )

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('GitError')
    }
  })
})

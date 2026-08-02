import { parseUnifiedDiff } from '@shared/unified-diff'
import { Effect, Either } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRepoFixture, type RepoFixture } from '../../test-support/repo-fixtures'
import { runOp } from '../../test-support/run-op'
import { closeRepo, getCommitDetail, getDiff, openRepo } from '../index'

const getParsedDiff = (...args: Parameters<typeof getDiff>) =>
  getDiff(...args).pipe(Effect.map((result) => ({ diff: parseUnifiedDiff(result.patch) })))

let repoDir: string
let repo: RepoFixture
const sha: Record<string, string> = {}

beforeAll(async () => {
  repo = createRepoFixture({
    prefix: 'rebase-commit-detail-',
    userEmail: 'author@example.com',
    userName: 'Ada Author'
  })
  repoDir = repo.path

  repo.write('one.txt', 'a\nb\nc\n')
  repo.write('doomed.txt', 'gone\n')
  repo.write('logo.png', Buffer.from([0, 1, 2, 3, 0, 255]))
  repo.git('add', '-A')
  sha.root = repo.commitStaged('root commit')

  repo.write('one.txt', 'a\nB\nc\n')
  repo.write('added.txt', 'fresh\n')
  repo.git('rm', '-q', 'doomed.txt')
  repo.mkdir('assets')
  repo.git('mv', 'logo.png', 'assets/logo.png')
  repo.git('add', '-A')
  sha.second = repo.commitStaged('second commit\n\nA body paragraph.\nAnd a second line.')

  repo.git('checkout', '-q', '-b', 'side', sha.root)
  repo.write('side.txt', 'from the side\n')
  repo.git('add', '-A')
  sha.side = repo.commitStaged('side commit')

  repo.git('checkout', '-q', 'main')
  repo.git(
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
  sha.merge = repo.head()

  await runOp(openRepo(repoDir))
})

afterAll(async () => {
  await runOp(closeRepo(repoDir))
  repo.cleanup()
})

describe('getCommitDetail', () => {
  it('reports metadata, message body and the changed files of an ordinary commit', async () => {
    const { detail } = await runOp(getCommitDetail(repoDir, sha.second))

    expect(detail.sha).toBe(sha.second)
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

    expect(detail.files.map((file) => [file.path, file.status])).toEqual([
      ['doomed.txt', 'A'],
      ['logo.png', 'A'],
      ['one.txt', 'A']
    ])
  })

  it('reports a merge commit against its first parent', async () => {
    const { detail } = await runOp(getCommitDetail(repoDir, sha.merge))

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
    const { diff } = await runOp(getParsedDiff(repoDir, 'one.txt', false, { commit: sha.second }))

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
    const { diff } = await runOp(getParsedDiff(repoDir, 'one.txt', false, { commit: sha.root }))

    expect(diff.hunks).toHaveLength(1)
    expect(diff.hunks[0].lines.map((line) => line.kind)).toEqual(['add', 'add', 'add'])
  })

  it('shows a deleted file as removals', async () => {
    const { diff } = await runOp(
      getParsedDiff(repoDir, 'doomed.txt', false, { commit: sha.second })
    )

    expect(diff.hunks[0].lines.map((line) => [line.kind, line.text])).toEqual([['del', 'gone']])
  })

  it("diffs a merge against its first parent, so the side branch's file reads as added", async () => {
    const { diff } = await runOp(getParsedDiff(repoDir, 'side.txt', false, { commit: sha.merge }))

    expect(diff.hunks).toHaveLength(1)
    expect(diff.hunks[0].lines.map((line) => [line.kind, line.text])).toEqual([
      ['add', 'from the side']
    ])
  })

  it('returns no hunks for a pure rename, which carries no content change', async () => {
    const { diff } = await runOp(
      getParsedDiff(repoDir, 'assets/logo.png', false, {
        commit: sha.second,
        renameSource: 'logo.png'
      })
    )

    expect(diff.hunks).toEqual([])
  })

  it('flags an edited binary file instead of returning hunks', async () => {
    repo.write('assets/logo.png', Buffer.from([9, 8, 7, 0, 6]))
    repo.git('add', '-A')
    const binarySha = repo.commitStaged('touch up the logo')

    const { diff } = await runOp(
      getParsedDiff(repoDir, 'assets/logo.png', false, { commit: binarySha })
    )

    expect(diff.binary).toBe(true)
    expect(diff.hunks).toEqual([])
  })

  it('reads a rename as a rename when given the old path alongside the new one', async () => {
    repo.git('mv', 'one.txt', 'renamed.txt')
    repo.write('renamed.txt', 'a\nB\nC\n')
    repo.git('add', '-A')
    const renameSha = repo.commitStaged('rename and edit')

    const { diff } = await runOp(
      getParsedDiff(repoDir, 'renamed.txt', false, { commit: renameSha, renameSource: 'one.txt' })
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

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Effect, type Either } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeRepo, openRepo, pushRepo } from '../operations'
import { type RepoSessions, RepoSessionsLive } from '../repo-sessions'

// Each case spins a fresh bare remote, a clone, and teammate clones, then drives a real push (and an
// internal fetch on lease refusal). Under full-suite parallelism those git spawns blow past the 5s
// default, so give the real-git work room.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

let base: string
let remoteDir: string
let repoDir: string

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' })
}

function sha(dir: string, ref: string): string {
  return git(dir, 'rev-parse', ref).trim()
}

function writeCommit(dir: string, content: string, message: string): void {
  fs.writeFileSync(path.join(dir, 'file.txt'), content)
  git(dir, 'add', '.')
  git(dir, 'commit', '-m', message)
}

// A second clone advancing the remote stands in for a teammate (or another machine) publishing while
// the user holds a stale view of the branch — the exact condition the lease must refuse.
function advanceRemote(content: string, message: string): string {
  const other = fs.mkdtempSync(path.join(base, 'other-'))
  execFileSync('git', ['clone', remoteDir, other])
  git(other, 'config', 'user.email', 'other@example.com')
  git(other, 'config', 'user.name', 'Other')
  fs.writeFileSync(path.join(other, 'file.txt'), content)
  git(other, 'add', '.')
  git(other, 'commit', '-m', message)
  git(other, 'push', 'origin', 'HEAD:main')
  return sha(other, 'HEAD')
}

function createRemoteBranch(branch: string, content: string, message: string): string {
  const other = fs.mkdtempSync(path.join(base, 'other-'))
  execFileSync('git', ['clone', remoteDir, other])
  git(other, 'config', 'user.email', 'other@example.com')
  git(other, 'config', 'user.name', 'Other')
  git(other, 'checkout', '-b', branch)
  fs.writeFileSync(path.join(other, 'file.txt'), content)
  git(other, 'add', '.')
  git(other, 'commit', '-m', message)
  git(other, 'push', 'origin', branch)
  return sha(other, 'HEAD')
}

const runOp = <A, E>(effect: Effect.Effect<A, E, RepoSessions>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(RepoSessionsLive)))

const runEither = <A, E>(effect: Effect.Effect<A, E, RepoSessions>): Promise<Either.Either<A, E>> =>
  Effect.runPromise(Effect.either(effect).pipe(Effect.provide(RepoSessionsLive)))

beforeEach(async () => {
  base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-force-push-')))
  remoteDir = path.join(base, 'remote.git')
  repoDir = path.join(base, 'clone')
  execFileSync('git', ['init', '--bare', '-b', 'main', remoteDir])
  execFileSync('git', ['clone', remoteDir, repoDir])
  git(repoDir, 'config', 'user.email', 'test@example.com')
  git(repoDir, 'config', 'user.name', 'Test')
  writeCommit(repoDir, 'base\n', 'base')
  git(repoDir, 'push', '--set-upstream', 'origin', 'main')
  await runOp(openRepo(repoDir))
})

afterEach(async () => {
  await runOp(closeRepo(repoDir))
  fs.rmSync(base, { recursive: true, force: true })
})

describe('pushRepo force-with-lease against a real repository', () => {
  it('republishes an amended tip with a leased force (Tier 1 happy path)', async () => {
    fs.writeFileSync(path.join(repoDir, 'file.txt'), 'amended\n')
    git(repoDir, 'commit', '-a', '--amend', '-m', 'amended base')

    await runOp(pushRepo(repoDir, 'with-lease'))

    expect(sha(repoDir, 'main')).toBe(sha(repoDir, 'origin/main'))
  })

  it('refuses a plain push on a Diverged branch with reason non-fast-forward', async () => {
    advanceRemote('teammate\n', 'teammate work')
    writeCommit(repoDir, 'local\n', 'local work')

    const result = await runEither(pushRepo(repoDir))

    expect(result._tag).toBe('Left')
    if (result._tag === 'Left') {
      expect(result.left._tag).toBe('PushRejected')
      if (result.left._tag === 'PushRejected') {
        expect(result.left.reason).toBe('non-fast-forward')
        expect(result.left.lostCommits).toEqual([])
        expect(result.left.remoteSha).toBeUndefined()
      }
    }
    expect(sha(repoDir, 'main')).not.toBe(sha(repoDir, 'origin/main'))
  })

  it('refuses a leased push with reason lease-stale and folds in the loss preview', async () => {
    writeCommit(repoDir, 'local\n', 'local work')
    const remoteTip = advanceRemote('teammate\n', 'teammate work')

    const result = await runEither(pushRepo(repoDir, 'with-lease'))

    expect(result._tag).toBe('Left')
    if (result._tag === 'Left' && result.left._tag === 'PushRejected') {
      expect(result.left.reason).toBe('lease-stale')
      expect(result.left.remoteSha).toBe(remoteTip)
      expect(result.left.lostCommits.map((commit) => commit.subject)).toEqual(['teammate work'])
      expect(remoteTip.startsWith(result.left.lostCommits[0].sha)).toBe(true)
    } else {
      expect.fail('expected a PushRejected failure')
    }
  })

  it('fetches the configured non-origin remote for a lease-loss preview', async () => {
    git(repoDir, 'remote', 'rename', 'origin', 'team')
    writeCommit(repoDir, 'local\n', 'local work')
    const remoteTip = advanceRemote('teammate\n', 'teammate work')

    const result = await runEither(pushRepo(repoDir, 'with-lease'))

    if (result._tag === 'Left' && result.left._tag === 'PushRejected') {
      expect(result.left.remoteSha).toBe(remoteTip)
      expect(result.left.lostCommits.map((commit) => commit.subject)).toEqual(['teammate work'])
    } else {
      expect.fail('expected a PushRejected failure')
    }
  })

  it('refuses a leased push with reason remote-moved after a background fetch advanced the remote-tracking ref', async () => {
    writeCommit(repoDir, 'local\n', 'local work')
    const remoteTip = advanceRemote('teammate\n', 'teammate work')
    git(repoDir, 'fetch', 'origin')

    const result = await runEither(pushRepo(repoDir, 'with-lease'))

    expect(result._tag).toBe('Left')
    if (result._tag === 'Left' && result.left._tag === 'PushRejected') {
      expect(result.left.reason).toBe('remote-moved')
      expect(result.left.remoteSha).toBe(remoteTip)
      expect(result.left.lostCommits.map((commit) => commit.subject)).toEqual(['teammate work'])
    } else {
      expect.fail('expected a PushRejected failure')
    }
  })

  it('overwrites the remote when pinned to the current remote tip (Tier 2 happy path)', async () => {
    writeCommit(repoDir, 'local\n', 'local work')
    const remoteTip = advanceRemote('teammate\n', 'teammate work')

    await runOp(pushRepo(repoDir, 'overwrite', remoteTip))

    expect(sha(repoDir, 'origin/main')).toBe(sha(repoDir, 'main'))
    expect(sha(repoDir, 'origin/main')).not.toBe(remoteTip)
  })

  it('rejects an overwrite request without an expected remote SHA', async () => {
    writeCommit(repoDir, 'local\n', 'local work')

    const result = await runEither(pushRepo(repoDir, 'overwrite'))

    if (result._tag === 'Left') {
      expect(result.left._tag).toBe('GitError')
    } else {
      expect.fail('expected a GitError failure')
    }
  })

  it('refuses a pinned overwrite when a commit landed after the captured sha and re-shows the loss', async () => {
    writeCommit(repoDir, 'local\n', 'local work')
    const stalePin = advanceRemote('teammate\n', 'teammate work')
    const newTip = advanceRemote('teammate-2\n', 'second teammate work')

    const result = await runEither(pushRepo(repoDir, 'overwrite', stalePin))

    expect(result._tag).toBe('Left')
    if (result._tag === 'Left' && result.left._tag === 'PushRejected') {
      expect(result.left.remoteSha).toBe(newTip)
      expect(result.left.lostCommits.map((commit) => commit.subject)).toEqual([
        'second teammate work',
        'teammate work'
      ])
    } else {
      expect.fail('expected a PushRejected failure')
    }
    expect(sha(repoDir, 'origin/main')).not.toBe(sha(repoDir, 'main'))
  })

  it('creates the branch and sets upstream when force-pushing a branch with no upstream', async () => {
    git(repoDir, 'checkout', '-b', 'feature/new')
    writeCommit(repoDir, 'feature\n', 'feature work')

    await runOp(pushRepo(repoDir, 'with-lease'))

    expect(
      git(repoDir, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}').trim()
    ).toBe('origin/feature/new')
    expect(sha(repoDir, 'feature/new')).toBe(sha(repoDir, 'origin/feature/new'))
  })

  it('refuses a leased force on a no-upstream branch whose name was created on the remote concurrently', async () => {
    git(repoDir, 'checkout', '-b', 'feature/dup')
    writeCommit(repoDir, 'mine\n', 'my feature work')
    createRemoteBranch('feature/dup', 'theirs\n', 'their feature work')

    const result = await runEither(pushRepo(repoDir, 'with-lease'))

    expect(result._tag).toBe('Left')
    if (result._tag === 'Left' && result.left._tag === 'PushRejected') {
      expect(result.left.lostCommits.map((commit) => commit.subject)).toEqual([
        'their feature work'
      ])
    } else {
      expect.fail('expected a PushRejected failure')
    }
    expect(git(repoDir, 'rev-parse', 'feature/dup').trim()).not.toBe(
      git(repoDir, 'rev-parse', 'origin/feature/dup').trim()
    )
  })
})

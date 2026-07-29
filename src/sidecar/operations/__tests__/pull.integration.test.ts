import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Effect, Either } from 'effect'
import { describe, expect, it } from 'vitest'
import { runOp } from '../../test-support/run-op'
import { closeRepo, getStatus, openRepo, pullRepo } from '../index'

interface PullFixture {
  path: string
  /** Where the remote's `main` sits after it advanced past the clone. */
  remoteTip: string
  /** The commit the clone starts on, shared with the remote's history. */
  base: string
}

// stdio keeps git's own progress and conflict chatter out of the test reporter; execFileSync would
// otherwise pass stderr straight through to the parent.
function runGit(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function run(cwd: string, args: string[]): string {
  return runGit(['-C', cwd, ...args])
}

function sha(cwd: string, ref: string): string {
  return run(cwd, ['rev-parse', ref]).trim()
}

function readFile(repo: string, name: string): string {
  return fs.readFileSync(path.join(repo, name), 'utf8')
}

function writeFile(repo: string, name: string, contents: string): void {
  fs.writeFileSync(path.join(repo, name), contents)
}

function identify(repo: string): void {
  run(repo, ['config', 'user.email', 'test@example.com'])
  run(repo, ['config', 'user.name', 'Test'])
  run(repo, ['config', 'commit.gpgsign', 'false'])
}

// A clone whose remote has moved on: `a.txt` was rewritten upstream, `b.txt` was left alone.
function makePullFixture(): PullFixture {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-pull-test-')))
  const remote = path.join(base, 'remote.git')
  const author = path.join(base, 'author')
  const clone = path.join(base, 'clone')

  runGit(['init', '--bare', '-b', 'main', remote])
  runGit(['clone', '--quiet', remote, author])
  identify(author)
  writeFile(author, 'a.txt', 'a base\n')
  writeFile(author, 'b.txt', 'b base\n')
  run(author, ['add', '.'])
  run(author, ['commit', '-m', 'base'])
  run(author, ['push', '--quiet', '--set-upstream', 'origin', 'main'])

  runGit(['clone', '--quiet', remote, clone])
  identify(clone)
  // The whole suite runs under the hostile config on purpose: pullRepo must neutralize a
  // user-level pull.rebase=true, or git swaps the integration strategy under --ff-only and
  // refuses any dirty tree with "cannot pull with rebase".
  run(clone, ['config', 'pull.rebase', 'true'])
  const baseSha = sha(clone, 'HEAD')

  writeFile(author, 'a.txt', 'a upstream\n')
  run(author, ['commit', '-am', 'upstream rewrites a'])
  run(author, ['push', '--quiet', 'origin', 'main'])

  return { path: clone, remoteTip: sha(author, 'HEAD'), base: baseSha }
}

async function withPullFixture<T>(use: (fixture: PullFixture) => Promise<T>): Promise<T> {
  const fixture = makePullFixture()
  await runOp(openRepo(fixture.path))
  try {
    return await use(fixture)
  } finally {
    await runOp(closeRepo(fixture.path))
    fs.rmSync(path.dirname(fixture.path), { recursive: true, force: true, maxRetries: 10 })
  }
}

async function pullFailure(repoPath: string): Promise<{ _tag: string; message: string }> {
  const result = await runOp(Effect.either(pullRepo(repoPath)))
  if (Either.isRight(result)) {
    throw new Error('expected the pull to fail')
  }
  return result.left as { _tag: string; message: string }
}

describe('pullRepo with local changes in the way', () => {
  it('refuses to overwrite an uncommitted edit to a file the remote also changed', async () => {
    await withPullFixture(async (fixture) => {
      writeFile(fixture.path, 'a.txt', 'a mine\n')

      const error = await pullFailure(fixture.path)

      expect(error._tag).toBe('GitError')
      expect(error.message).toMatch(/would be overwritten/i)
      expect(error.message).toContain('a.txt')
      expect(readFile(fixture.path, 'a.txt')).toBe('a mine\n')
      expect(sha(fixture.path, 'HEAD')).toBe(fixture.base)
    })
  })

  it('fast-forwards past local edits to an unrelated file, keeping them', async () => {
    await withPullFixture(async (fixture) => {
      writeFile(fixture.path, 'b.txt', 'b mine\n')

      await runOp(pullRepo(fixture.path))

      expect(sha(fixture.path, 'HEAD')).toBe(fixture.remoteTip)
      expect(readFile(fixture.path, 'a.txt')).toBe('a upstream\n')
      expect(readFile(fixture.path, 'b.txt')).toBe('b mine\n')
      const { status } = await runOp(getStatus(fixture.path))
      expect(status.modified).toEqual(['b.txt'])
    })
  })

  it('refuses a diverged branch without leaving a merge behind to clean up', async () => {
    await withPullFixture(async (fixture) => {
      writeFile(fixture.path, 'a.txt', 'a mine\n')
      run(fixture.path, ['commit', '-am', 'local work'])
      const headBefore = sha(fixture.path, 'HEAD')

      const error = await pullFailure(fixture.path)

      expect(error._tag).toBe('GitError')
      expect(error.message).toMatch(/fast-forward/i)
      expect(sha(fixture.path, 'HEAD')).toBe(headBefore)
      const { status } = await runOp(getStatus(fixture.path))
      expect(status.operation).toBeUndefined()
      expect(status.conflicted).toEqual([])
    })
  })

  // A stray Pull click during a conflict resolution must not touch the operation the user is
  // halfway through.
  it('refuses while a conflicted merge is in progress and leaves it intact', async () => {
    await withPullFixture(async (fixture) => {
      run(fixture.path, ['checkout', '--quiet', '-b', 'feature'])
      writeFile(fixture.path, 'b.txt', 'b feature\n')
      run(fixture.path, ['commit', '-am', 'feature edits b'])
      run(fixture.path, ['checkout', '--quiet', 'main'])
      writeFile(fixture.path, 'b.txt', 'b main\n')
      run(fixture.path, ['commit', '-am', 'main edits b'])
      const headBefore = sha(fixture.path, 'HEAD')
      try {
        run(fixture.path, ['merge', '--no-edit', 'feature'])
      } catch {}
      const conflictedContents = readFile(fixture.path, 'b.txt')

      const error = await pullFailure(fixture.path)

      expect(error._tag).toBe('GitError')
      expect(error.message).toMatch(/unmerged files/i)
      expect(sha(fixture.path, 'HEAD')).toBe(headBefore)
      expect(readFile(fixture.path, 'b.txt')).toBe(conflictedContents)
      const { status } = await runOp(getStatus(fixture.path))
      expect(status.conflicted).toEqual(['b.txt'])
      expect(status.operation?.kind).toBe('merge')
    })
  })
})

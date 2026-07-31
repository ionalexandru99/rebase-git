import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Effect, Either } from 'effect'
import { describe, expect, it } from 'vitest'
import { runOp } from '../../test-support/run-op'
import { abortOperation, closeRepo, getStatus, openRepo, pullRepo } from '../index'

interface PullFixture {
  path: string
  remoteTip: string
  base: string
}

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

  it('rejects a diverged branch as PullDiverged without leaving a merge behind to clean up', async () => {
    await withPullFixture(async (fixture) => {
      writeFile(fixture.path, 'a.txt', 'a mine\n')
      run(fixture.path, ['commit', '-am', 'local work'])
      const headBefore = sha(fixture.path, 'HEAD')

      const error = await pullFailure(fixture.path)

      expect(error._tag).toBe('PullDiverged')
      expect(sha(fixture.path, 'HEAD')).toBe(headBefore)
      const { status } = await runOp(getStatus(fixture.path))
      expect(status.operation).toBeUndefined()
      expect(status.conflicted).toEqual([])
    })
  })

  it('rebases local commits onto upstream when told to rebase', async () => {
    await withPullFixture(async (fixture) => {
      writeFile(fixture.path, 'b.txt', 'b mine\n')
      run(fixture.path, ['commit', '-am', 'local work'])

      await runOp(pullRepo(fixture.path, 'rebase'))

      expect(sha(fixture.path, 'HEAD~1')).toBe(fixture.remoteTip)
      expect(readFile(fixture.path, 'a.txt')).toBe('a upstream\n')
      expect(readFile(fixture.path, 'b.txt')).toBe('b mine\n')
      const { status } = await runOp(getStatus(fixture.path))
      expect(status.operation).toBeUndefined()
      expect(status.conflicted).toEqual([])
    })
  })

  it('merges upstream into the local branch when told to merge', async () => {
    await withPullFixture(async (fixture) => {
      writeFile(fixture.path, 'b.txt', 'b mine\n')
      run(fixture.path, ['commit', '-am', 'local work'])
      const localTip = sha(fixture.path, 'HEAD')

      await runOp(pullRepo(fixture.path, 'merge'))

      expect(sha(fixture.path, 'HEAD^1')).toBe(localTip)
      expect(sha(fixture.path, 'HEAD^2')).toBe(fixture.remoteTip)
      expect(readFile(fixture.path, 'a.txt')).toBe('a upstream\n')
      expect(readFile(fixture.path, 'b.txt')).toBe('b mine\n')
      const { status } = await runOp(getStatus(fixture.path))
      expect(status.operation).toBeUndefined()
      expect(status.conflicted).toEqual([])
    })
  })

  it('stops a conflicting rebase pull in the conflict flow, and abort restores the branch', async () => {
    await withPullFixture(async (fixture) => {
      writeFile(fixture.path, 'a.txt', 'a mine\n')
      run(fixture.path, ['commit', '-am', 'local work'])
      const localTip = sha(fixture.path, 'HEAD')

      const result = await runOp(Effect.either(pullRepo(fixture.path, 'rebase')))
      if (Either.isRight(result)) {
        throw new Error('expected the rebase pull to stop on conflicts')
      }

      expect(result.left._tag).toBe('Conflict')
      const { status } = await runOp(getStatus(fixture.path))
      expect(status.operation?.kind).toBe('rebase-merge')
      expect(status.conflicted).toEqual(['a.txt'])

      await runOp(abortOperation(fixture.path))

      expect(sha(fixture.path, 'HEAD')).toBe(localTip)
      const after = await runOp(getStatus(fixture.path))
      expect(after.status.operation).toBeUndefined()
      expect(after.status.conflicted).toEqual([])
    })
  })

  it('stops a conflicting merge pull in the conflict flow with the merge in progress', async () => {
    await withPullFixture(async (fixture) => {
      writeFile(fixture.path, 'a.txt', 'a mine\n')
      run(fixture.path, ['commit', '-am', 'local work'])

      const result = await runOp(Effect.either(pullRepo(fixture.path, 'merge')))
      if (Either.isRight(result)) {
        throw new Error('expected the merge pull to stop on conflicts')
      }

      expect(result.left._tag).toBe('Conflict')
      const { status } = await runOp(getStatus(fixture.path))
      expect(status.operation?.kind).toBe('merge')
      expect(status.conflicted).toEqual(['a.txt'])
    })
  })

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
      expect(run(fixture.path, ['diff', '--name-only', '--diff-filter=U']).trim()).toBe('b.txt')
      const conflictedContents = readFile(fixture.path, 'b.txt')

      const error = await pullFailure(fixture.path)

      expect(error._tag).toBe('OperationInProgress')
      expect(sha(fixture.path, 'HEAD')).toBe(headBefore)
      expect(readFile(fixture.path, 'b.txt')).toBe(conflictedContents)
      const { status } = await runOp(getStatus(fixture.path))
      expect(status.conflicted).toEqual(['b.txt'])
      expect(status.operation?.kind).toBe('merge')
    })
  })

  it('refuses a strategy pull while a merge is in progress instead of reporting a conflict', async () => {
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

      const result = await runOp(Effect.either(pullRepo(fixture.path, 'rebase')))
      if (Either.isRight(result)) {
        throw new Error('expected the strategy pull to be refused')
      }

      expect(result.left._tag).toBe('OperationInProgress')
      expect(sha(fixture.path, 'HEAD')).toBe(headBefore)
      const { status } = await runOp(getStatus(fixture.path))
      expect(status.operation?.kind).toBe('merge')
    })
  })
})

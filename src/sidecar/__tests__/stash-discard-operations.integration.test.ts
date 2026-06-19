import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Effect, Either } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  closeRepo,
  discardAll,
  discardChanges,
  getStatus,
  openRepo,
  stashApply,
  stashDrop,
  stashList,
  stashPop,
  stashPush
} from '../operations'

let repoDir: string

function git(...args: string[]): string {
  return execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8' })
}

function write(name: string, contents: string): void {
  fs.writeFileSync(path.join(repoDir, name), contents)
}

function read(name: string): string {
  return fs.readFileSync(path.join(repoDir, name), 'utf8')
}

function porcelain(): string {
  return git('status', '--porcelain').trim()
}

beforeAll(async () => {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-sd-test-')))
  repoDir = path.join(base, 'repo')
  fs.mkdirSync(repoDir)
  execFileSync('git', ['-C', repoDir, 'init', '-b', 'main'])
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  write('tracked.txt', 'base\n')
  git('add', '.')
  git('commit', '-m', 'base')

  await Effect.runPromise(openRepo(repoDir))
})

afterAll(async () => {
  await Effect.runPromise(closeRepo(repoDir))
  fs.rmSync(path.dirname(repoDir), { recursive: true, force: true })
})

describe('stash', () => {
  it('pushes, lists, pops, and drops a stash', async () => {
    write('tracked.txt', 'modified\n')
    await Effect.runPromise(stashPush(repoDir, 'work in progress'))
    expect(porcelain()).toBe('')

    const listed = await Effect.runPromise(stashList(repoDir))
    expect(listed.stashes).toHaveLength(1)
    expect(listed.stashes[0].index).toBe(0)
    expect(listed.stashes[0].ref).toBe('stash@{0}')
    expect(listed.stashes[0].branch).toBe('main')
    expect(listed.stashes[0].message).toBe('work in progress')

    await Effect.runPromise(stashPop(repoDir, 0))
    expect(read('tracked.txt')).toBe('modified\n')
    const afterPop = await Effect.runPromise(stashList(repoDir))
    expect(afterPop.stashes).toHaveLength(0)

    // restore clean state for the next test
    git('checkout', '--', 'tracked.txt')
  })

  it('applies a stash without removing it, then drops it', async () => {
    write('tracked.txt', 'applied-change\n')
    await Effect.runPromise(stashPush(repoDir))
    await Effect.runPromise(stashApply(repoDir, 0))
    expect(read('tracked.txt')).toBe('applied-change\n')

    const stillThere = await Effect.runPromise(stashList(repoDir))
    expect(stillThere.stashes).toHaveLength(1)

    await Effect.runPromise(stashDrop(repoDir, 0))
    const empty = await Effect.runPromise(stashList(repoDir))
    expect(empty.stashes).toHaveLength(0)

    git('checkout', '--', 'tracked.txt')
  })

  it('rejects a negative stash index', async () => {
    const result = await Effect.runPromise(Effect.either(stashDrop(repoDir, -1)))
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('GitError')
    }
  })

  it('stashes only the given files, leaving others modified', async () => {
    write('second.txt', 'second base\n')
    git('add', '.')
    git('commit', '-m', 'add second')

    write('tracked.txt', 'changed-tracked\n')
    write('second.txt', 'changed-second\n')

    await Effect.runPromise(stashPush(repoDir, 'partial', false, ['tracked.txt']))
    expect(read('tracked.txt')).toBe('base\n')
    expect(read('second.txt')).toBe('changed-second\n')

    await Effect.runPromise(stashPop(repoDir, 0))
    expect(read('tracked.txt')).toBe('changed-tracked\n')

    git('checkout', '--', 'tracked.txt', 'second.txt')
  })

  it('rejects an option-injecting file path', async () => {
    const result = await Effect.runPromise(
      Effect.either(stashPush(repoDir, undefined, false, ['--all']))
    )
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('GitError')
    }
  })
})

describe('discard', () => {
  it('restores a modified tracked file', async () => {
    write('tracked.txt', 'dirty\n')
    await Effect.runPromise(discardChanges(repoDir, ['tracked.txt']))
    expect(read('tracked.txt')).toBe('base\n')
  })

  it('deletes an untracked file', async () => {
    write('untracked.txt', 'temp\n')
    await Effect.runPromise(discardChanges(repoDir, ['untracked.txt']))
    expect(fs.existsSync(path.join(repoDir, 'untracked.txt'))).toBe(false)
  })

  it('rejects an option-injecting path', async () => {
    const result = await Effect.runPromise(Effect.either(discardChanges(repoDir, ['--all'])))
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('GitError')
    }
  })

  it('restores a tracked file whose name has a space', async () => {
    write('a b.txt', 'space base\n')
    git('add', 'a b.txt')
    git('commit', '-m', 'add spaced file')
    write('a b.txt', 'dirty space\n')

    await Effect.runPromise(discardChanges(repoDir, ['a b.txt']))
    expect(read('a b.txt')).toBe('space base\n')
  })

  it('restores a tracked unicode-named file and deletes an untracked unicode-named file', async () => {
    write('café.txt', 'unicode base\n')
    git('add', 'café.txt')
    git('commit', '-m', 'add unicode file')
    write('café.txt', 'dirty unicode\n')
    write('résumé.txt', 'temp unicode\n')

    await Effect.runPromise(discardChanges(repoDir, ['café.txt', 'résumé.txt']))
    expect(read('café.txt')).toBe('unicode base\n')
    expect(fs.existsSync(path.join(repoDir, 'résumé.txt'))).toBe(false)
  })

  it('deletes an untracked unicode-named file instead of restoring it', async () => {
    write('naïve.txt', 'temp\n')
    await Effect.runPromise(discardChanges(repoDir, ['naïve.txt']))
    expect(fs.existsSync(path.join(repoDir, 'naïve.txt'))).toBe(false)
  })

  it('discards everything with discardAll', async () => {
    write('tracked.txt', 'dirty again\n')
    write('another-untracked.txt', 'junk\n')
    await Effect.runPromise(discardAll(repoDir))
    expect(read('tracked.txt')).toBe('base\n')
    expect(fs.existsSync(path.join(repoDir, 'another-untracked.txt'))).toBe(false)
    const status = await Effect.runPromise(getStatus(repoDir))
    expect(status.status.modified).toHaveLength(0)
    expect(status.status.not_added).toHaveLength(0)
  })
})

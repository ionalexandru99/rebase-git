import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Effect, Either } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runOp } from '../../test-support/run-op'
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
} from '../index'

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

  await runOp(openRepo(repoDir))
})

afterAll(async () => {
  await runOp(closeRepo(repoDir))
  fs.rmSync(path.dirname(repoDir), { recursive: true, force: true })
})

describe('stash', () => {
  it('pushes, lists, pops, and drops a stash', async () => {
    write('tracked.txt', 'modified\n')
    await runOp(stashPush(repoDir, 'work in progress'))
    expect(porcelain()).toBe('')

    const listed = await runOp(stashList(repoDir))
    expect(listed.stashes).toHaveLength(1)
    expect(listed.stashes[0].index).toBe(0)
    expect(listed.stashes[0].ref).toBe('stash@{0}')
    expect(listed.stashes[0].oid).toBe(git('rev-parse', 'stash@{0}').trim())
    expect(listed.stashes[0].branch).toBe('main')
    expect(listed.stashes[0].message).toBe('work in progress')

    await runOp(stashPop(repoDir, 0, git('rev-parse', 'stash@{0}').trim()))
    expect(read('tracked.txt')).toBe('modified\n')
    const afterPop = await runOp(stashList(repoDir))
    expect(afterPop.stashes).toHaveLength(0)

    // restore clean state for the next test
    git('checkout', '--', 'tracked.txt')
  })

  it('applies a stash without removing it, then drops it', async () => {
    write('tracked.txt', 'applied-change\n')
    await runOp(stashPush(repoDir))
    await runOp(stashApply(repoDir, 0, git('rev-parse', 'stash@{0}').trim()))
    expect(read('tracked.txt')).toBe('applied-change\n')

    const stillThere = await runOp(stashList(repoDir))
    expect(stillThere.stashes).toHaveLength(1)

    await runOp(stashDrop(repoDir, 0, git('rev-parse', 'stash@{0}').trim()))
    const empty = await runOp(stashList(repoDir))
    expect(empty.stashes).toHaveLength(0)

    git('checkout', '--', 'tracked.txt')
  })

  it('rejects a negative stash index', async () => {
    const result = await runOp(Effect.either(stashDrop(repoDir, -1, 'unused')))
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('GitError')
    }
  })

  it('rejects a stale stash index when its expected OID moved', async () => {
    write('tracked.txt', 'first stash\n')
    await runOp(stashPush(repoDir, 'first'))
    const first = (await runOp(stashList(repoDir))).stashes[0]
    write('tracked.txt', 'second stash\n')
    await runOp(stashPush(repoDir, 'second'))

    const outcome = await runOp(Effect.either(stashDrop(repoDir, 0, first.oid)))

    expect(Either.isLeft(outcome)).toBe(true)
    const remaining = await runOp(stashList(repoDir))
    expect(remaining.stashes).toHaveLength(2)
    expect(remaining.stashes.map((stash) => stash.oid)).toContain(first.oid)
    git('stash', 'clear')
  })

  it('stashes only the given files, leaving others modified', async () => {
    write('second.txt', 'second base\n')
    git('add', '.')
    git('commit', '-m', 'add second')

    write('tracked.txt', 'changed-tracked\n')
    write('second.txt', 'changed-second\n')
    git('add', 'tracked.txt')

    await runOp(stashPush(repoDir, 'partial', false, ['tracked.txt']))
    expect(read('tracked.txt')).toBe('base\n')
    expect(read('second.txt')).toBe('changed-second\n')

    await runOp(stashPop(repoDir, 0, git('rev-parse', 'stash@{0}').trim()))
    expect(read('tracked.txt')).toBe('changed-tracked\n')

    git('reset', 'HEAD', '--', 'tracked.txt')
    git('checkout', '--', 'tracked.txt', 'second.txt')
  })

  it('stashes only staged hunks from a partially staged selected file', async () => {
    write('partial.txt', 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n')
    git('add', 'partial.txt')
    git('commit', '-m', 'add partial file')
    write('partial.txt', 'ONE\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n')
    git('add', 'partial.txt')
    write('partial.txt', 'ONE\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nTEN\n')

    await runOp(stashPush(repoDir, 'staged only', true, ['partial.txt']))

    expect(read('partial.txt')).toBe('one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nTEN\n')
    expect(git('diff', '--cached', '--name-only').trim()).toBe('')
    git('checkout', '--', 'partial.txt')
    git('stash', 'clear')
  })

  it('stashes and restores both paths of a selected staged rename', async () => {
    // Glob metacharacters on both paths keep this covering literal pathspecs; `[`/`]` are the
    // only ones Win32 permits in a filename.
    const source = 'stash old [source].txt'
    const destination = 'stash new [dest].txt'
    const unselected = 'stash new decoy.txt'
    write(unselected, 'decoy base\n')
    write(source, 'rename contents\n')
    git('add', source, unselected)
    git('commit', '-m', 'add stash rename source')
    write(unselected, 'decoy staged\n')
    git('add', unselected)
    write(unselected, 'decoy unstaged\n')
    git('mv', source, destination)

    await runOp(stashPush(repoDir, 'staged rename', false, [source, destination]))

    expect(read(source)).toBe('rename contents\n')
    expect(fs.existsSync(path.join(repoDir, destination))).toBe(false)
    expect(read(unselected)).toBe('decoy unstaged\n')
    expect(git('show', `:${unselected}`)).toBe('decoy staged\n')
    expect(git('diff', '--cached', '--name-only', '-z')).toBe(`${unselected}\0`)

    await runOp(stashApply(repoDir, 0, git('rev-parse', 'stash@{0}').trim()))

    expect(fs.existsSync(path.join(repoDir, source))).toBe(false)
    expect(read(destination)).toBe('rename contents\n')
    git('reset', '--hard', 'HEAD')
    git('stash', 'clear')
  })

  it('rejects an option-injecting file path', async () => {
    const result = await runOp(Effect.either(stashPush(repoDir, undefined, false, ['--all'])))
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('GitError')
    }
  })
})

describe('discard', () => {
  it('restores a modified tracked file', async () => {
    write('tracked.txt', 'dirty\n')
    await runOp(discardChanges(repoDir, ['tracked.txt']))
    expect(read('tracked.txt')).toBe('base\n')
  })

  it('deletes an untracked file', async () => {
    write('untracked.txt', 'temp\n')
    await runOp(discardChanges(repoDir, ['untracked.txt']))
    expect(fs.existsSync(path.join(repoDir, 'untracked.txt'))).toBe(false)
  })

  it('rejects an option-injecting path', async () => {
    const result = await runOp(Effect.either(discardChanges(repoDir, ['--all'])))
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

    await runOp(discardChanges(repoDir, ['a b.txt']))
    expect(read('a b.txt')).toBe('space base\n')
  })

  it('restores a tracked unicode-named file and deletes an untracked unicode-named file', async () => {
    write('café.txt', 'unicode base\n')
    git('add', 'café.txt')
    git('commit', '-m', 'add unicode file')
    write('café.txt', 'dirty unicode\n')
    write('résumé.txt', 'temp unicode\n')

    await runOp(discardChanges(repoDir, ['café.txt', 'résumé.txt']))
    expect(read('café.txt')).toBe('unicode base\n')
    expect(fs.existsSync(path.join(repoDir, 'résumé.txt'))).toBe(false)
  })

  it('deletes an untracked unicode-named file instead of restoring it', async () => {
    write('naïve.txt', 'temp\n')
    await runOp(discardChanges(repoDir, ['naïve.txt']))
    expect(fs.existsSync(path.join(repoDir, 'naïve.txt'))).toBe(false)
  })

  it('discards everything with discardAll', async () => {
    write('tracked.txt', 'dirty again\n')
    write('another-untracked.txt', 'junk\n')
    await runOp(discardAll(repoDir))
    expect(read('tracked.txt')).toBe('base\n')
    expect(fs.existsSync(path.join(repoDir, 'another-untracked.txt'))).toBe(false)
    const status = await runOp(getStatus(repoDir))
    expect(status.status.modified).toHaveLength(0)
    expect(status.status.not_added).toHaveLength(0)
  })

  it('discards a fully staged modification back to HEAD', async () => {
    write('tracked.txt', 'staged dirty\n')
    git('add', 'tracked.txt')
    await runOp(discardChanges(repoDir, ['tracked.txt']))
    expect(read('tracked.txt')).toBe('base\n')
    expect(porcelain()).toBe('')
  })

  it('discards staged and unstaged edits on the same file', async () => {
    write('tracked.txt', 'staged layer\n')
    git('add', 'tracked.txt')
    write('tracked.txt', 'unstaged layer\n')
    await runOp(discardChanges(repoDir, ['tracked.txt']))
    expect(read('tracked.txt')).toBe('base\n')
    expect(porcelain()).toBe('')
  })

  it('deletes a staged brand-new file from index and disk', async () => {
    write('staged-new.txt', 'newly added\n')
    git('add', 'staged-new.txt')
    await runOp(discardChanges(repoDir, ['staged-new.txt']))
    expect(fs.existsSync(path.join(repoDir, 'staged-new.txt'))).toBe(false)
    expect(porcelain()).toBe('')
  })

  it('discards staged, unstaged, and untracked files together in one call', async () => {
    write('tracked.txt', 'staged mixed\n')
    git('add', 'tracked.txt')
    write('second.txt', 'unstaged mixed\n')
    write('mixed-untracked.txt', 'junk\n')
    await runOp(discardChanges(repoDir, ['tracked.txt', 'second.txt', 'mixed-untracked.txt']))
    expect(read('tracked.txt')).toBe('base\n')
    expect(read('second.txt')).toBe('second base\n')
    expect(fs.existsSync(path.join(repoDir, 'mixed-untracked.txt'))).toBe(false)
    expect(porcelain()).toBe('')
  })

  it('discards both paths of a staged rename', async () => {
    write('rename-source.txt', 'renamed contents\n')
    git('add', 'rename-source.txt')
    git('commit', '-m', 'add rename source')
    git('mv', 'rename-source.txt', 'rename-destination.txt')

    await runOp(discardChanges(repoDir, ['rename-source.txt', 'rename-destination.txt']))

    expect(porcelain()).toBe('')
    expect(read('rename-source.txt')).toBe('renamed contents\n')
    expect(fs.existsSync(path.join(repoDir, 'rename-destination.txt'))).toBe(false)
  })
})

describe('discard in a repo with no commits', () => {
  it('deletes a staged new file from index and disk', { timeout: 15000 }, async () => {
    const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-sd-unborn-')))
    const unbornDir = path.join(base, 'repo')
    fs.mkdirSync(unbornDir)
    execFileSync('git', ['-C', unbornDir, 'init', '-b', 'main'])
    execFileSync('git', ['-C', unbornDir, 'config', 'user.email', 'test@example.com'])
    execFileSync('git', ['-C', unbornDir, 'config', 'user.name', 'Test'])
    fs.writeFileSync(path.join(unbornDir, 'first.txt'), 'unborn staged\n')
    execFileSync('git', ['-C', unbornDir, 'add', 'first.txt'])
    await runOp(openRepo(unbornDir))
    try {
      await runOp(discardChanges(unbornDir, ['first.txt']))
      expect(fs.existsSync(path.join(unbornDir, 'first.txt'))).toBe(false)
      const status = execFileSync('git', ['-C', unbornDir, 'status', '--porcelain'], {
        encoding: 'utf8'
      }).trim()
      expect(status).toBe('')
    } finally {
      await runOp(closeRepo(unbornDir))
      fs.rmSync(base, { recursive: true, force: true })
    }
  })

  it('discards all staged and untracked files', { timeout: 15000 }, async () => {
    const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-sd-unborn-')))
    const unbornDir = path.join(base, 'repo')
    fs.mkdirSync(unbornDir)
    execFileSync('git', ['-C', unbornDir, 'init', '-b', 'main'])
    fs.writeFileSync(path.join(unbornDir, 'staged.txt'), 'staged\n')
    fs.writeFileSync(path.join(unbornDir, 'untracked.txt'), 'untracked\n')
    execFileSync('git', ['-C', unbornDir, 'add', 'staged.txt'])
    await runOp(openRepo(unbornDir))
    try {
      await runOp(discardAll(unbornDir))
      expect(fs.existsSync(path.join(unbornDir, 'staged.txt'))).toBe(false)
      expect(fs.existsSync(path.join(unbornDir, 'untracked.txt'))).toBe(false)
      const status = execFileSync('git', ['-C', unbornDir, 'status', '--porcelain'], {
        encoding: 'utf8'
      }).trim()
      expect(status).toBe('')
    } finally {
      await runOp(closeRepo(unbornDir))
      fs.rmSync(base, { recursive: true, force: true })
    }
  })
})

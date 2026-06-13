import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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

  const opened = await openRepo(repoDir)
  expect(opened._tag).toBe('Ok')
})

afterAll(async () => {
  await closeRepo(repoDir)
  fs.rmSync(path.dirname(repoDir), { recursive: true, force: true })
})

describe('stash', () => {
  it('pushes, lists, pops, and drops a stash', async () => {
    write('tracked.txt', 'modified\n')
    const pushed = await stashPush(repoDir, 'work in progress')
    expect(pushed._tag).toBe('Ok')
    expect(porcelain()).toBe('')

    const listed = await stashList(repoDir)
    expect(listed._tag).toBe('Ok')
    if (listed._tag === 'Ok') {
      expect(listed.stashes).toHaveLength(1)
      expect(listed.stashes[0].index).toBe(0)
      expect(listed.stashes[0].ref).toBe('stash@{0}')
      expect(listed.stashes[0].branch).toBe('main')
      expect(listed.stashes[0].message).toBe('work in progress')
    }

    const popped = await stashPop(repoDir, 0)
    expect(popped._tag).toBe('Ok')
    expect(read('tracked.txt')).toBe('modified\n')
    const afterPop = await stashList(repoDir)
    expect(afterPop._tag === 'Ok' && afterPop.stashes).toHaveLength(0)

    // restore clean state for the next test
    git('checkout', '--', 'tracked.txt')
  })

  it('applies a stash without removing it, then drops it', async () => {
    write('tracked.txt', 'applied-change\n')
    await stashPush(repoDir)
    const applied = await stashApply(repoDir, 0)
    expect(applied._tag).toBe('Ok')
    expect(read('tracked.txt')).toBe('applied-change\n')

    const stillThere = await stashList(repoDir)
    expect(stillThere._tag === 'Ok' && stillThere.stashes).toHaveLength(1)

    const dropped = await stashDrop(repoDir, 0)
    expect(dropped._tag).toBe('Ok')
    const empty = await stashList(repoDir)
    expect(empty._tag === 'Ok' && empty.stashes).toHaveLength(0)

    git('checkout', '--', 'tracked.txt')
  })

  it('rejects a negative stash index', async () => {
    const result = await stashDrop(repoDir, -1)
    expect(result._tag).toBe('GitError')
  })
})

describe('discard', () => {
  it('restores a modified tracked file', async () => {
    write('tracked.txt', 'dirty\n')
    const result = await discardChanges(repoDir, ['tracked.txt'])
    expect(result._tag).toBe('Ok')
    expect(read('tracked.txt')).toBe('base\n')
  })

  it('deletes an untracked file', async () => {
    write('untracked.txt', 'temp\n')
    const result = await discardChanges(repoDir, ['untracked.txt'])
    expect(result._tag).toBe('Ok')
    expect(fs.existsSync(path.join(repoDir, 'untracked.txt'))).toBe(false)
  })

  it('rejects an option-injecting path', async () => {
    const result = await discardChanges(repoDir, ['--all'])
    expect(result._tag).toBe('GitError')
  })

  it('discards everything with discardAll', async () => {
    write('tracked.txt', 'dirty again\n')
    write('another-untracked.txt', 'junk\n')
    const result = await discardAll(repoDir)
    expect(result._tag).toBe('Ok')
    expect(read('tracked.txt')).toBe('base\n')
    expect(fs.existsSync(path.join(repoDir, 'another-untracked.txt'))).toBe(false)
    const status = await getStatus(repoDir)
    expect(status._tag).toBe('Ok')
    if (status._tag === 'Ok') {
      expect(status.status.modified).toHaveLength(0)
      expect(status.status.not_added).toHaveLength(0)
    }
  })
})

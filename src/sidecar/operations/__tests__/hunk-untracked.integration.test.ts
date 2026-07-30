import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { removeRepoDir } from '../../test-support/repo-fixtures'
import { runOp } from '../../test-support/run-op'
import { closeRepo, getDiff, getStatus, openRepo, stageHunk, unstageHunk } from '../index'

let repoDir: string

function git(...args: string[]): string {
  return execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8' })
}

function write(file: string, lines: string[]): void {
  fs.mkdirSync(path.dirname(path.join(repoDir, file)), { recursive: true })
  fs.writeFileSync(path.join(repoDir, file), `${lines.join('\n')}\n`)
}

function statusFor(file: string): string {
  return git('status', '--porcelain', '--', file).slice(0, 2)
}

beforeEach(async () => {
  repoDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-hunk-new-')))
  git('init', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  write('tracked.txt', ['base'])
  git('add', '--', 'tracked.txt')
  git('-c', 'commit.gpgsign=false', 'commit', '--no-gpg-sign', '-m', 'base')

  await runOp(openRepo(repoDir))
})

afterEach(async () => {
  await runOp(closeRepo(repoDir))
  removeRepoDir(repoDir)
})

describe('hunk staging on files git does not track yet', () => {
  it('stages the hunk of an untracked file into the index', async () => {
    write('brand-new.txt', ['alpha', 'beta', 'gamma'])

    const unstaged = await runOp(getDiff(repoDir, 'brand-new.txt', false))
    expect(unstaged.diff.hunks).toHaveLength(1)

    await runOp(stageHunk(repoDir, 'brand-new.txt', unstaged.diff.hunks[0].header))

    expect(git('show', ':brand-new.txt')).toBe('alpha\nbeta\ngamma\n')
    expect(statusFor('brand-new.txt')).toBe('A ')
    expect(fs.readFileSync(path.join(repoDir, 'brand-new.txt'), 'utf8')).toBe(
      'alpha\nbeta\ngamma\n'
    )
  })

  it('stages the hunk of an untracked file inside a subdirectory', async () => {
    write('nested/deep/brand-new.txt', ['one', 'two'])

    const unstaged = await runOp(getDiff(repoDir, 'nested/deep/brand-new.txt', false))
    expect(unstaged.diff.hunks).toHaveLength(1)

    await runOp(stageHunk(repoDir, 'nested/deep/brand-new.txt', unstaged.diff.hunks[0].header))

    expect(git('show', ':nested/deep/brand-new.txt')).toBe('one\ntwo\n')
  })

  it('stages the hunk of an untracked file in a repository with no commits', async () => {
    await runOp(closeRepo(repoDir))
    removeRepoDir(repoDir)
    repoDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-hunk-empty-')))
    git('init', '-b', 'main')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'Test')
    write('first.txt', ['hello'])
    await runOp(openRepo(repoDir))

    const unstaged = await runOp(getDiff(repoDir, 'first.txt', false))
    expect(unstaged.diff.hunks).toHaveLength(1)

    await runOp(stageHunk(repoDir, 'first.txt', unstaged.diff.hunks[0].header))

    expect(git('show', ':first.txt')).toBe('hello\n')
    expect(statusFor('first.txt')).toBe('A ')
  })

  it('stages one hunk of a partially staged new file and leaves the other unstaged', async () => {
    const lines = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`)
    write('multi.txt', lines)
    const initial = await runOp(getDiff(repoDir, 'multi.txt', false))
    await runOp(stageHunk(repoDir, 'multi.txt', initial.diff.hunks[0].header))

    const edited = [...lines]
    edited[0] = 'line 1 EDITED'
    edited[35] = 'line 36 EDITED'
    write('multi.txt', edited)

    const unstaged = await runOp(getDiff(repoDir, 'multi.txt', false))
    expect(unstaged.diff.hunks).toHaveLength(2)

    await runOp(stageHunk(repoDir, 'multi.txt', unstaged.diff.hunks[0].header))

    expect(git('show', ':multi.txt')).toContain('line 1 EDITED')
    expect(git('show', ':multi.txt')).not.toContain('line 36 EDITED')

    const remaining = await runOp(getDiff(repoDir, 'multi.txt', false))
    expect(remaining.diff.hunks).toHaveLength(1)
    expect(remaining.diff.hunks[0].lines.some((line) => line.text === 'line 36 EDITED')).toBe(true)
  })

  it('ships the untracked fallback text as the patch, matching the hunks beside it', async () => {
    write('patch-check.txt', ['alpha', 'beta'])

    const result = await runOp(getDiff(repoDir, 'patch-check.txt', false))

    expect(result.patch).toContain('new file mode')
    expect(result.patch).toContain('@@ -0,0 +1,2 @@')
    for (const hunk of result.diff.hunks) {
      expect(result.patch).toContain(hunk.header)
    }
    expect(result.patch).toContain('+alpha')
  })

  it('unstages the hunk of a staged new file back to untracked', async () => {
    write('staged-new.txt', ['alpha', 'beta'])
    git('add', '--', 'staged-new.txt')

    const staged = await runOp(getDiff(repoDir, 'staged-new.txt', true))
    expect(staged.diff.hunks).toHaveLength(1)

    await runOp(unstageHunk(repoDir, 'staged-new.txt', staged.diff.hunks[0].header))

    expect(statusFor('staged-new.txt')).toBe('??')
    expect(fs.readFileSync(path.join(repoDir, 'staged-new.txt'), 'utf8')).toBe('alpha\nbeta\n')

    const status = await runOp(getStatus(repoDir))
    expect(status.status.staged).not.toContain('staged-new.txt')
  })
})

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runOp } from '../../test-support/run-op'
import { closeRepo, getWorkingTreeStats, openRepo } from '../index'

let repoDir: string

function git(...args: string[]): string {
  return execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8' })
}

function write(file: string, contents: string): void {
  fs.writeFileSync(path.join(repoDir, file), contents)
}

beforeAll(async () => {
  repoDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-worktree-stats-')))
  git('init', '-b', 'main')
  git('config', 'user.email', 'author@example.com')
  git('config', 'user.name', 'Ada Author')

  write('one.txt', 'a\nb\nc\n')
  write('two.txt', 'x\ny\n')
  git('add', '-A')
  git('-c', 'commit.gpgsign=false', 'commit', '--no-gpg-sign', '-m', 'root commit')

  await runOp(openRepo(repoDir))
})

afterAll(async () => {
  await runOp(closeRepo(repoDir))
  fs.rmSync(repoDir, { recursive: true, force: true })
})

describe('getWorkingTreeStats', () => {
  it('reports zeros for a clean tree', async () => {
    const stats = await runOp(getWorkingTreeStats(repoDir))

    expect(stats).toEqual({ additions: 0, deletions: 0 })
  })

  it('totals tracked and untracked changes against HEAD', async () => {
    write('one.txt', 'a\nB\nc\nd\ne\n')
    write('two.txt', 'x\n')
    write('untracked.txt', 'p\nq\nr\n')

    const stats = await runOp(getWorkingTreeStats(repoDir))

    expect(stats).toEqual({ additions: 6, deletions: 2 })
  })

  it('keeps the same totals once part of the change is staged', async () => {
    git('add', '--', 'one.txt')

    const stats = await runOp(getWorkingTreeStats(repoDir))

    expect(stats).toEqual({ additions: 6, deletions: 2 })
  })

  it('counts staged files against the empty tree while HEAD is still unborn', async () => {
    const unbornDir = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-worktree-stats-unborn-'))
    )
    execFileSync('git', ['-C', unbornDir, 'init', '-b', 'main'], { encoding: 'utf8' })
    fs.writeFileSync(path.join(unbornDir, 'fresh.txt'), 'a\nb\n')
    execFileSync('git', ['-C', unbornDir, 'add', '-A'], { encoding: 'utf8' })
    await runOp(openRepo(unbornDir))

    try {
      const stats = await runOp(getWorkingTreeStats(unbornDir))

      expect(stats).toEqual({ additions: 2, deletions: 0 })
    } finally {
      await runOp(closeRepo(unbornDir))
      fs.rmSync(unbornDir, { recursive: true, force: true })
    }
  })
})

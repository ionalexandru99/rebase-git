import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { amendCommit, casAdvanceHead, closeRepo, getHeadCommit, openRepo } from '../operations'
import { runOp } from './run-op'

let repoDir: string

function git(...args: string[]): string {
  return execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8' })
}

function commitFile(name: string, contents: string, message: string): void {
  fs.writeFileSync(path.join(repoDir, name), contents)
  git('add', '.')
  git('commit', '-m', message)
}

function show(format: string, rev = 'HEAD'): string {
  return git('show', '-s', `--format=${format}`, rev).trim()
}

beforeEach(async () => {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-amend-test-')))
  repoDir = path.join(base, 'repo')
  fs.mkdirSync(repoDir)
  execFileSync('git', ['-C', repoDir, 'init', '-b', 'main'])
  git('config', 'user.email', 'committer@example.com')
  git('config', 'user.name', 'Committer')
  await runOp(openRepo(repoDir))
})

afterEach(async () => {
  await runOp(closeRepo(repoDir))
  fs.rmSync(path.dirname(repoDir), { recursive: true, force: true })
})

describe('amendCommit — reword', () => {
  it('rewrites HEAD message, preserving author + author-date and advancing the committer', async () => {
    commitFile('file.txt', 'base\n', 'base')
    const baseSha = git('rev-parse', 'HEAD').trim()

    fs.writeFileSync(path.join(repoDir, 'file.txt'), 'second\n')
    git('add', '.')
    execFileSync('git', ['-C', repoDir, 'commit', '-m', 'original subject'], {
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Original Author',
        GIT_AUTHOR_EMAIL: 'author@example.com',
        GIT_AUTHOR_DATE: '2020-01-02T03:04:05+00:00'
      }
    })

    const originalTree = show('%T')
    const originalAuthorDate = show('%aI')

    await runOp(amendCommit(repoDir, 'reworded subject\n\nwith a body', []))

    expect(show('%B')).toBe('reworded subject\n\nwith a body')
    expect(show('%an')).toBe('Original Author')
    expect(show('%ae')).toBe('author@example.com')
    expect(show('%aI')).toBe(originalAuthorDate)
    expect(show('%T')).toBe(originalTree)
    expect(git('rev-parse', 'HEAD~1').trim()).toBe(baseSha)
    expect(show('%cn')).toBe('Committer')
  })
})

describe('amendCommit — fold in staged changes', () => {
  it('folds the current index into the rewritten commit and leaves the tree clean', async () => {
    commitFile('a.txt', 'base\n', 'base')
    const baseSha = git('rev-parse', 'HEAD').trim()
    commitFile('b.txt', 'two\n', 'second')

    fs.writeFileSync(path.join(repoDir, 'a.txt'), 'folded\n')
    git('add', 'a.txt')

    await runOp(amendCommit(repoDir, 'second reworded', []))

    expect(git('show', 'HEAD:a.txt')).toBe('folded\n')
    expect(git('show', 'HEAD:b.txt')).toBe('two\n')
    expect(show('%s')).toBe('second reworded')
    expect(git('rev-parse', 'HEAD~1').trim()).toBe(baseSha)
    expect(git('status', '--porcelain').trim()).toBe('')
  })
})

function parentsOf(rev = 'HEAD'): string[] {
  return git('rev-list', '--parents', '-n', '1', rev).trim().split(' ').slice(1)
}

describe('amendCommit — parents preserved', () => {
  it('keeps both parents of a merge commit (a merge stays a merge)', async () => {
    commitFile('base.txt', 'base\n', 'base')
    git('checkout', '-b', 'feature')
    commitFile('feature.txt', 'feat\n', 'feature work')
    git('checkout', 'main')
    commitFile('main.txt', 'main\n', 'main work')
    git('merge', '--no-ff', 'feature', '-m', 'merge feature')

    const parentsBefore = parentsOf()
    expect(parentsBefore).toHaveLength(2)

    await runOp(amendCommit(repoDir, 'merge feature (reworded)', []))

    expect(parentsOf()).toEqual(parentsBefore)
    expect(show('%s')).toBe('merge feature (reworded)')
  })

  it('keeps a root commit parentless', async () => {
    commitFile('only.txt', 'root\n', 'root commit')
    expect(parentsOf()).toHaveLength(0)

    await runOp(amendCommit(repoDir, 'root reworded', []))

    expect(parentsOf()).toHaveLength(0)
    expect(show('%s')).toBe('root reworded')
    expect(git('show', 'HEAD:only.txt')).toBe('root\n')
  })
})

describe('getHeadCommit', () => {
  it('returns the full subject+body message, parent count, and name-status files', async () => {
    commitFile('a.txt', 'base\n', 'base')
    fs.writeFileSync(path.join(repoDir, 'a.txt'), 'changed\n')
    fs.writeFileSync(path.join(repoDir, 'b.txt'), 'new\n')
    git('add', '.')
    git('commit', '-m', 'subject line\n\nbody paragraph')

    const head = await runOp(getHeadCommit(repoDir))

    expect(head.result.message).toBe('subject line\n\nbody paragraph')
    expect(head.result.parentCount).toBe(1)
    expect(head.result.files).toContainEqual({ status: 'M', path: 'a.txt' })
    expect(head.result.files).toContainEqual({ status: 'A', path: 'b.txt' })
  })

  it('reports two parents for a merge commit', async () => {
    commitFile('base.txt', 'base\n', 'base')
    git('checkout', '-b', 'feature')
    commitFile('feature.txt', 'feat\n', 'feature work')
    git('checkout', 'main')
    commitFile('main.txt', 'main\n', 'main work')
    git('merge', '--no-ff', 'feature', '-m', 'merge feature')

    const head = await runOp(getHeadCommit(repoDir))

    expect(head.result.parentCount).toBe(2)
    expect(head.result.message).toBe('merge feature')
  })
})

describe('amendCommit — compare-and-swap', () => {
  it('refuses to advance HEAD when it moved underneath (head-moved)', async () => {
    commitFile('x.txt', 'a\n', 'first')
    const first = git('rev-parse', 'HEAD').trim()
    commitFile('x.txt', 'b\n', 'second')
    const moved = git('rev-parse', 'HEAD').trim()

    const outcome = await runOp(casAdvanceHead(repoDir, first, first))

    expect(outcome).toBe('head-moved')
    expect(git('rev-parse', 'HEAD').trim()).toBe(moved)
  })
})

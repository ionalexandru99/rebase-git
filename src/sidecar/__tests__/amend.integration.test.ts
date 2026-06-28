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

function workingTree(name: string): string {
  return fs.readFileSync(path.join(repoDir, name), 'utf8')
}

describe('amendCommit — drop files', () => {
  it('reverts a dropped modification to its parent content, surfacing the new version as a working change', async () => {
    commitFile('a.txt', 'base\n', 'base')
    const baseSha = git('rev-parse', 'HEAD').trim()
    commitFile('a.txt', 'changed\n', 'second')

    await runOp(amendCommit(repoDir, 'second', ['a.txt']))

    expect(git('show', 'HEAD:a.txt')).toBe('base\n')
    expect(workingTree('a.txt')).toBe('changed\n')
    expect(git('status', '--porcelain').trim()).toBe('M a.txt')
    expect(git('rev-parse', 'HEAD~1').trim()).toBe(baseSha)
  })

  it('removes a dropped addition from the commit, leaving it as an untracked working file', async () => {
    commitFile('base.txt', 'base\n', 'base')
    const baseSha = git('rev-parse', 'HEAD').trim()
    commitFile('new.txt', 'new\n', 'second')

    await runOp(amendCommit(repoDir, 'second', ['new.txt']))

    expect(() => git('show', 'HEAD:new.txt')).toThrow()
    expect(workingTree('new.txt')).toBe('new\n')
    expect(git('status', '--porcelain').trim()).toBe('?? new.txt')
    expect(git('rev-parse', 'HEAD~1').trim()).toBe(baseSha)
  })

  it('restores a dropped deletion to the commit, surfacing the deletion as a working change', async () => {
    commitFile('del.txt', 'content\n', 'base')
    const baseSha = git('rev-parse', 'HEAD').trim()
    fs.rmSync(path.join(repoDir, 'del.txt'))
    git('add', '-A')
    git('commit', '-m', 'second')

    await runOp(amendCommit(repoDir, 'second', ['del.txt']))

    expect(git('show', 'HEAD:del.txt')).toBe('content\n')
    expect(fs.existsSync(path.join(repoDir, 'del.txt'))).toBe(false)
    expect(git('status', '--porcelain').trim()).toBe('D del.txt')
    expect(git('rev-parse', 'HEAD~1').trim()).toBe(baseSha)
  })

  it('drops a file from a root commit (the absent parent means it is removed)', async () => {
    fs.writeFileSync(path.join(repoDir, 'keep.txt'), 'keep\n')
    fs.writeFileSync(path.join(repoDir, 'drop.txt'), 'drop\n')
    git('add', '.')
    git('commit', '-m', 'root')

    await runOp(amendCommit(repoDir, 'root', ['drop.txt']))

    expect(parentsOf()).toHaveLength(0)
    expect(git('show', 'HEAD:keep.txt')).toBe('keep\n')
    expect(() => git('show', 'HEAD:drop.txt')).toThrow()
    expect(workingTree('drop.txt')).toBe('drop\n')
    expect(git('status', '--porcelain').trim()).toBe('?? drop.txt')
  })
})

function committedHunkHeaders(file: string): string[] {
  const out = git('diff', '--no-color', '--no-ext-diff', '--unified=3', 'HEAD~1..HEAD', '--', file)
  return out.split('\n').filter((line) => line.startsWith('@@ '))
}

describe('amendCommit — drop hunks', () => {
  it('reverts only a dropped hunk, keeps the rest of the commit, and surfaces that hunk as a working change', async () => {
    const parent = 'a1\na2\na3\na4\na5\na6\na7\na8\na9\na10\na11\na12\na13\n'
    const head = 'A1\na2\na3\na4\na5\na6\na7\na8\na9\na10\na11\na12\nA13\n'
    commitFile('multi.txt', parent, 'base')
    const baseSha = git('rev-parse', 'HEAD').trim()
    commitFile('multi.txt', head, 'second')

    const headers = committedHunkHeaders('multi.txt')
    expect(headers).toHaveLength(2)

    await runOp(amendCommit(repoDir, 'second', [], [{ file: 'multi.txt', hunks: [headers[0]] }]))

    const committed = git('show', 'HEAD:multi.txt')
    expect(committed.split('\n')[0]).toBe('a1')
    expect(committed.trimEnd().split('\n').at(-1)).toBe('A13')
    expect(workingTree('multi.txt')).toBe(head)
    expect(git('status', '--porcelain').trim()).toBe('M multi.txt')
    expect(git('rev-parse', 'HEAD~1').trim()).toBe(baseSha)
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

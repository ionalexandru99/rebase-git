import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  cherryPick,
  closeRepo,
  createBranch,
  createTag,
  deleteBranch,
  deleteTag,
  getLocalBranches,
  getRemoteRefs,
  mergeBranch,
  openRepo,
  renameBranch,
  resetToCommit,
  revertCommit
} from '../operations'

let repoDir: string

function git(...args: string[]): string {
  return execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8' })
}

function currentBranch(): string {
  return git('rev-parse', '--abbrev-ref', 'HEAD').trim()
}

function readFile(name: string): string {
  return fs.readFileSync(path.join(repoDir, name), 'utf8')
}

function commitFile(name: string, contents: string, message: string): void {
  fs.writeFileSync(path.join(repoDir, name), contents)
  git('add', '.')
  git('commit', '-m', message)
}

beforeAll(async () => {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-bc-test-')))
  repoDir = path.join(base, 'repo')
  fs.mkdirSync(repoDir)
  execFileSync('git', ['-C', repoDir, 'init', '-b', 'main'])
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  commitFile('file.txt', 'base\n', 'base')

  const opened = await openRepo(repoDir)
  expect(opened._tag).toBe('Ok')
})

afterAll(async () => {
  await closeRepo(repoDir)
  fs.rmSync(path.dirname(repoDir), { recursive: true, force: true })
})

describe('branch operations', () => {
  it('creates a branch without switching to it', async () => {
    const result = await createBranch(repoDir, 'feature/one')
    expect(result._tag).toBe('Ok')
    expect(currentBranch()).toBe('main')
    const local = await getLocalBranches(repoDir)
    expect(local._tag === 'Ok' && local.branches.all.includes('feature/one')).toBe(true)
  })

  it('creates and checks out a branch in one step', async () => {
    const result = await createBranch(repoDir, 'feature/two', undefined, true)
    expect(result._tag).toBe('Ok')
    expect(currentBranch()).toBe('feature/two')
    git('checkout', 'main')
  })

  it('rejects an option-injecting branch name', async () => {
    const result = await createBranch(repoDir, '--track')
    expect(result._tag).toBe('GitError')
  })

  it('renames a branch', async () => {
    await createBranch(repoDir, 'feature/old')
    const result = await renameBranch(repoDir, 'feature/old', 'feature/new')
    expect(result._tag).toBe('Ok')
    const local = await getLocalBranches(repoDir)
    expect(local._tag === 'Ok' && local.branches.all.includes('feature/new')).toBe(true)
    expect(local._tag === 'Ok' && local.branches.all.includes('feature/old')).toBe(false)
  })

  it('deletes a branch', async () => {
    await createBranch(repoDir, 'feature/trash')
    const result = await deleteBranch(repoDir, 'feature/trash')
    expect(result._tag).toBe('Ok')
    const local = await getLocalBranches(repoDir)
    expect(local._tag === 'Ok' && local.branches.all.includes('feature/trash')).toBe(false)
  })

  it('refuses to delete an unmerged branch without force, but force deletes it', async () => {
    await createBranch(repoDir, 'feature/unmerged', undefined, true)
    commitFile('unmerged.txt', 'work\n', 'unmerged work')
    git('checkout', 'main')
    const soft = await deleteBranch(repoDir, 'feature/unmerged')
    expect(soft._tag).toBe('GitError')
    const forced = await deleteBranch(repoDir, 'feature/unmerged', true)
    expect(forced._tag).toBe('Ok')
  })
})

describe('merge', () => {
  it('merges a branch cleanly', async () => {
    git('checkout', 'main')
    await createBranch(repoDir, 'merge/clean', undefined, true)
    commitFile('clean.txt', 'clean\n', 'add clean file')
    git('checkout', 'main')
    const result = await mergeBranch(repoDir, 'merge/clean')
    expect(result._tag).toBe('Ok')
    expect(fs.existsSync(path.join(repoDir, 'clean.txt'))).toBe(true)
  })

  it('reports a conflict without throwing', async () => {
    git('checkout', 'main')
    commitFile('conflict.txt', 'main-side\n', 'main side of conflict')
    await createBranch(repoDir, 'merge/conflict', 'HEAD~1', true)
    commitFile('conflict.txt', 'branch-side\n', 'branch side of conflict')
    git('checkout', 'main')
    const result = await mergeBranch(repoDir, 'merge/conflict')
    expect(result._tag).toBe('Conflict')
    git('merge', '--abort')
  })
})

describe('reset', () => {
  it('resets the current branch to a commit with the chosen mode', async () => {
    git('checkout', 'main')
    await createBranch(repoDir, 'reset/target', undefined, true)
    commitFile('reset.txt', 'first\n', 'first')
    const headBefore = git('rev-parse', 'HEAD').trim()
    commitFile('reset.txt', 'second\n', 'second')

    const soft = await resetToCommit(repoDir, headBefore, 'soft')
    expect(soft._tag).toBe('Ok')
    expect(git('rev-parse', 'HEAD').trim()).toBe(headBefore)
    // soft keeps the working tree, so the later content survives
    expect(readFile('reset.txt')).toBe('second\n')

    const hard = await resetToCommit(repoDir, headBefore, 'hard')
    expect(hard._tag).toBe('Ok')
    expect(readFile('reset.txt')).toBe('first\n')
    git('checkout', 'main')
  })
})

describe('revert and cherry-pick', () => {
  it('reverts a commit', async () => {
    git('checkout', 'main')
    await createBranch(repoDir, 'revert/target', undefined, true)
    commitFile('revert.txt', 'added\n', 'add revert file')
    const target = git('rev-parse', 'HEAD').trim()
    const result = await revertCommit(repoDir, target)
    expect(result._tag).toBe('Ok')
    expect(fs.existsSync(path.join(repoDir, 'revert.txt'))).toBe(false)
    git('checkout', 'main')
  })

  it('cherry-picks a commit from another branch', async () => {
    git('checkout', 'main')
    await createBranch(repoDir, 'pick/source', undefined, true)
    commitFile('pick.txt', 'picked\n', 'pick this commit')
    const source = git('rev-parse', 'HEAD').trim()
    git('checkout', 'main')
    const result = await cherryPick(repoDir, source)
    expect(result._tag).toBe('Ok')
    expect(readFile('pick.txt')).toBe('picked\n')
  })
})

describe('tags', () => {
  it('creates a lightweight tag and an annotated tag, then deletes one', async () => {
    git('checkout', 'main')
    const lightweight = await createTag(repoDir, 'v-light')
    expect(lightweight._tag).toBe('Ok')
    const annotated = await createTag(repoDir, 'v-annotated', undefined, 'release notes')
    expect(annotated._tag).toBe('Ok')

    const refs = await getRemoteRefs(repoDir)
    expect(refs._tag === 'Ok' && refs.refs.tags.includes('v-light')).toBe(true)
    expect(refs._tag === 'Ok' && refs.refs.tags.includes('v-annotated')).toBe(true)
    expect(git('cat-file', '-t', 'v-annotated').trim()).toBe('tag')

    const deleted = await deleteTag(repoDir, 'v-light')
    expect(deleted._tag).toBe('Ok')
    const after = await getRemoteRefs(repoDir)
    expect(after._tag === 'Ok' && after.refs.tags.includes('v-light')).toBe(false)
  })
})

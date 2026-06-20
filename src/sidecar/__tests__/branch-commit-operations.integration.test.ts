import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Effect, Either } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  checkoutRef,
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

  await Effect.runPromise(openRepo(repoDir))
})

afterAll(async () => {
  await Effect.runPromise(closeRepo(repoDir))
  fs.rmSync(path.dirname(repoDir), { recursive: true, force: true })
})

describe('branch operations', () => {
  it('creates a branch without switching to it', async () => {
    await Effect.runPromise(createBranch(repoDir, 'feature/one'))
    expect(currentBranch()).toBe('main')
    const local = await Effect.runPromise(getLocalBranches(repoDir))
    expect(local.branches.all.includes('feature/one')).toBe(true)
  })

  it('creates and checks out a branch in one step', async () => {
    await Effect.runPromise(createBranch(repoDir, 'feature/two', undefined, true))
    expect(currentBranch()).toBe('feature/two')
    git('checkout', 'main')
  })

  it('rejects an option-injecting branch name', async () => {
    const result = await Effect.runPromise(Effect.either(createBranch(repoDir, '--track')))
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('GitError')
    }
  })

  it('renames a branch', async () => {
    await Effect.runPromise(createBranch(repoDir, 'feature/old'))
    await Effect.runPromise(renameBranch(repoDir, 'feature/old', 'feature/new'))
    const local = await Effect.runPromise(getLocalBranches(repoDir))
    expect(local.branches.all.includes('feature/new')).toBe(true)
    expect(local.branches.all.includes('feature/old')).toBe(false)
  })

  it('deletes a branch', async () => {
    await Effect.runPromise(createBranch(repoDir, 'feature/trash'))
    await Effect.runPromise(deleteBranch(repoDir, 'feature/trash'))
    const local = await Effect.runPromise(getLocalBranches(repoDir))
    expect(local.branches.all.includes('feature/trash')).toBe(false)
  })

  it('refuses to delete an unmerged branch without force, but force deletes it', async () => {
    await Effect.runPromise(createBranch(repoDir, 'feature/unmerged', undefined, true))
    commitFile('unmerged.txt', 'work\n', 'unmerged work')
    git('checkout', 'main')
    const soft = await Effect.runPromise(Effect.either(deleteBranch(repoDir, 'feature/unmerged')))
    expect(Either.isLeft(soft)).toBe(true)
    if (Either.isLeft(soft)) {
      expect(soft.left._tag).toBe('GitError')
    }
    await Effect.runPromise(deleteBranch(repoDir, 'feature/unmerged', true))
  })
})

describe('checkout', () => {
  it('checks out a local branch whose name collides with a tracked path', async () => {
    git('checkout', 'main')
    commitFile('collide', 'data\n', 'add a file named collide')
    await Effect.runPromise(createBranch(repoDir, 'collide'))
    await Effect.runPromise(checkoutRef(repoDir, 'local', 'collide'))
    expect(currentBranch()).toBe('collide')
    git('checkout', 'main')
  })
})

describe('merge', () => {
  it('merges a branch cleanly', async () => {
    git('checkout', 'main')
    await Effect.runPromise(createBranch(repoDir, 'merge/clean', undefined, true))
    commitFile('clean.txt', 'clean\n', 'add clean file')
    git('checkout', 'main')
    await Effect.runPromise(mergeBranch(repoDir, 'merge/clean'))
    expect(fs.existsSync(path.join(repoDir, 'clean.txt'))).toBe(true)
  })

  it('reports a conflict without throwing', async () => {
    git('checkout', 'main')
    commitFile('conflict.txt', 'main-side\n', 'main side of conflict')
    await Effect.runPromise(createBranch(repoDir, 'merge/conflict', 'HEAD~1', true))
    commitFile('conflict.txt', 'branch-side\n', 'branch side of conflict')
    git('checkout', 'main')
    const result = await Effect.runPromise(Effect.either(mergeBranch(repoDir, 'merge/conflict')))
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('Conflict')
    }
    git('merge', '--abort')
  })
})

describe('reset', () => {
  it('resets the current branch to a commit with the chosen mode', async () => {
    git('checkout', 'main')
    await Effect.runPromise(createBranch(repoDir, 'reset/target', undefined, true))
    commitFile('reset.txt', 'first\n', 'first')
    const headBefore = git('rev-parse', 'HEAD').trim()
    commitFile('reset.txt', 'second\n', 'second')

    await Effect.runPromise(resetToCommit(repoDir, headBefore, 'soft'))
    expect(git('rev-parse', 'HEAD').trim()).toBe(headBefore)
    // soft keeps the working tree, so the later content survives
    expect(readFile('reset.txt')).toBe('second\n')

    await Effect.runPromise(resetToCommit(repoDir, headBefore, 'hard'))
    expect(readFile('reset.txt')).toBe('first\n')
    git('checkout', 'main')
  })
})

describe('revert and cherry-pick', () => {
  it('reverts a commit', async () => {
    git('checkout', 'main')
    await Effect.runPromise(createBranch(repoDir, 'revert/target', undefined, true))
    commitFile('revert.txt', 'added\n', 'add revert file')
    const target = git('rev-parse', 'HEAD').trim()
    await Effect.runPromise(revertCommit(repoDir, target))
    expect(fs.existsSync(path.join(repoDir, 'revert.txt'))).toBe(false)
    git('checkout', 'main')
  })

  it('cherry-picks a commit from another branch', async () => {
    git('checkout', 'main')
    await Effect.runPromise(createBranch(repoDir, 'pick/source', undefined, true))
    commitFile('pick.txt', 'picked\n', 'pick this commit')
    const source = git('rev-parse', 'HEAD').trim()
    git('checkout', 'main')
    await Effect.runPromise(cherryPick(repoDir, source))
    expect(readFile('pick.txt')).toBe('picked\n')
  })
})

describe('tags', () => {
  it('creates a lightweight tag and an annotated tag, then deletes one', async () => {
    git('checkout', 'main')
    await Effect.runPromise(createTag(repoDir, 'v-light'))
    await Effect.runPromise(createTag(repoDir, 'v-annotated', undefined, 'release notes'))

    const refs = await Effect.runPromise(getRemoteRefs(repoDir))
    expect(refs.refs.tags.includes('v-light')).toBe(true)
    expect(refs.refs.tags.includes('v-annotated')).toBe(true)
    expect(git('cat-file', '-t', 'v-annotated').trim()).toBe('tag')

    await Effect.runPromise(deleteTag(repoDir, 'v-light'))
    const after = await Effect.runPromise(getRemoteRefs(repoDir))
    expect(after.refs.tags.includes('v-light')).toBe(false)
  })
})

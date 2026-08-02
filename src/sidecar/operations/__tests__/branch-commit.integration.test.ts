import fs from 'node:fs'
import path from 'node:path'
import { Effect, Either, Stream } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRepoFixture, type RepoFixture } from '../../test-support/repo-fixtures'
import { runOp } from '../../test-support/run-op'
import {
  checkoutRef,
  cherryPick,
  closeRepo,
  createBranch,
  createTag,
  deleteBranch,
  deleteTag,
  detectOperationState,
  getLocalBranches,
  getRemoteRefs,
  mergeBranch,
  openRepo,
  renameBranch,
  resetToCommit,
  revertCommit
} from '../index'
import { logChunkStream } from '../log-stream'

let repoDir: string
let repo: RepoFixture

function git(...args: string[]): string {
  return repo.git(...args)
}

function currentBranch(): string {
  return git('rev-parse', '--abbrev-ref', 'HEAD').trim()
}

function readFile(name: string): string {
  return repo.read(name)
}

function commitFile(name: string, contents: string, message: string): void {
  repo.write(name, contents)
  repo.git('add', '.')
  repo.commitStaged(message)
}

beforeAll(async () => {
  repo = createRepoFixture({ prefix: 'rebase-bc-test-' })
  repoDir = repo.path
  commitFile('file.txt', 'base\n', 'base')

  await runOp(openRepo(repoDir))
})

afterAll(async () => {
  await runOp(closeRepo(repoDir))
  repo.cleanup()
})

describe('branch operations', () => {
  it('creates a branch without switching to it', async () => {
    await runOp(createBranch(repoDir, 'feature/one'))
    expect(currentBranch()).toBe('main')
    const local = await runOp(getLocalBranches(repoDir))
    expect(local.branches.all.includes('feature/one')).toBe(true)
  })

  it('creates and checks out a branch in one step', async () => {
    await runOp(createBranch(repoDir, 'feature/two', undefined, true))
    expect(currentBranch()).toBe('feature/two')
    git('checkout', 'main')
  })

  it('rejects an option-injecting branch name', async () => {
    const result = await runOp(Effect.either(createBranch(repoDir, '--track')))
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('GitError')
    }
  })

  it('renames a branch', async () => {
    await runOp(createBranch(repoDir, 'feature/old'))
    await runOp(renameBranch(repoDir, 'feature/old', 'feature/new'))
    const local = await runOp(getLocalBranches(repoDir))
    expect(local.branches.all.includes('feature/new')).toBe(true)
    expect(local.branches.all.includes('feature/old')).toBe(false)
  })

  it('deletes a branch', async () => {
    await runOp(createBranch(repoDir, 'feature/trash'))
    await runOp(deleteBranch(repoDir, 'feature/trash'))
    const local = await runOp(getLocalBranches(repoDir))
    expect(local.branches.all.includes('feature/trash')).toBe(false)
  })

  it('refuses to delete an unmerged branch without force, but force deletes it', async () => {
    await runOp(createBranch(repoDir, 'feature/unmerged', undefined, true))
    commitFile('unmerged.txt', 'work\n', 'unmerged work')
    git('checkout', 'main')
    const soft = await runOp(Effect.either(deleteBranch(repoDir, 'feature/unmerged')))
    expect(Either.isLeft(soft)).toBe(true)
    if (Either.isLeft(soft)) {
      expect(soft.left._tag).toBe('GitError')
    }
    await runOp(deleteBranch(repoDir, 'feature/unmerged', true))
  })
})

describe('checkout', () => {
  it('checks out a local branch whose name collides with a tracked path', async () => {
    git('checkout', 'main')
    commitFile('collide', 'data\n', 'add a file named collide')
    await runOp(createBranch(repoDir, 'collide'))
    await runOp(checkoutRef(repoDir, 'local', 'collide'))
    expect(currentBranch()).toBe('collide')
    git('checkout', 'main')
  })

  it('detaches at a tag when a local branch has the same short name', async () => {
    git('checkout', 'main')
    commitFile('tag-target.txt', 'target\n', 'tag target')
    const tagTarget = git('rev-parse', 'HEAD').trim()
    git('tag', 'shared-name', tagTarget)
    git('branch', 'shared-name', 'HEAD~1')

    await runOp(checkoutRef(repoDir, 'tag', 'shared-name'))

    expect(git('rev-parse', 'HEAD').trim()).toBe(tagTarget)
    expect(() => git('symbolic-ref', '--quiet', '--short', 'HEAD')).toThrow()
    git('checkout', 'main')
  })
})

describe('streamed log revision coverage', () => {
  const streamedHashes = async (): Promise<string[]> => {
    const chunks = await Effect.runPromise(Stream.runCollect(logChunkStream(repoDir)))
    return Array.from(chunks).flatMap((chunk) => chunk.commits.map((commit) => commit.hash))
  }

  it('includes the current detached HEAD commit', async () => {
    git('checkout', '--detach', 'main')
    commitFile('detached.txt', 'detached\n', 'detached work')
    const detachedSha = git('rev-parse', 'HEAD').trim()

    expect(await streamedHashes()).toContain(detachedSha)
    git('checkout', 'main')
  })

  it('includes commits reachable only from a tag', async () => {
    git('checkout', '--detach', 'main')
    commitFile('tagged-only.txt', 'tagged\n', 'tagged only')
    const taggedSha = git('rev-parse', 'HEAD').trim()
    git('tag', 'tagged-only')
    git('checkout', 'main')

    expect(await streamedHashes()).toContain(taggedSha)
  })
})

describe('merge', () => {
  it('merges a branch cleanly', async () => {
    git('checkout', 'main')
    await runOp(createBranch(repoDir, 'merge/clean', undefined, true))
    commitFile('clean.txt', 'clean\n', 'add clean file')
    git('checkout', 'main')
    await runOp(mergeBranch(repoDir, 'local', 'merge/clean'))
    expect(fs.existsSync(path.join(repoDir, 'clean.txt'))).toBe(true)
  })

  it('names a merge commit after the short ref, not the qualified one', async () => {
    git('checkout', 'main')
    await runOp(createBranch(repoDir, 'merge/named', undefined, true))
    commitFile('named.txt', 'named\n', 'named work')
    git('checkout', 'main')
    commitFile('named-main.txt', 'main\n', 'main work beside the merge')

    await runOp(mergeBranch(repoDir, 'local', 'merge/named'))

    expect(git('log', '-1', '--format=%s').trim()).toMatch(/^Merge branch 'merge\/named'/)
  })

  it('prefills the conflicted merge message and marks conflicts with the short ref', async () => {
    git('checkout', 'main')
    commitFile('prefill.txt', 'main-side\n', 'main side of prefill')
    await runOp(createBranch(repoDir, 'merge/prefill', 'HEAD~1', true))
    commitFile('prefill.txt', 'branch-side\n', 'branch side of prefill')
    git('checkout', 'main')

    await runOp(Effect.either(mergeBranch(repoDir, 'local', 'merge/prefill')))

    try {
      const operation = await detectOperationState(repoDir)
      expect(operation?.mergeMessage).toMatch(/^Merge branch 'merge\/prefill'/)
      expect(readFile('prefill.txt')).toContain('>>>>>>> merge/prefill')
      expect(readFile('prefill.txt')).not.toContain('refs/heads/')
    } finally {
      git('merge', '--abort')
    }
  })

  it('reports a conflict without throwing', async () => {
    git('checkout', 'main')
    commitFile('conflict.txt', 'main-side\n', 'main side of conflict')
    await runOp(createBranch(repoDir, 'merge/conflict', 'HEAD~1', true))
    commitFile('conflict.txt', 'branch-side\n', 'branch side of conflict')
    git('checkout', 'main')
    const result = await runOp(Effect.either(mergeBranch(repoDir, 'local', 'merge/conflict')))

    try {
      expect(Either.isLeft(result)).toBe(true)
      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe('Conflict')
      }
    } finally {
      git('merge', '--abort')
    }
  })

  it('merges the local branch when a tag has the same short name', async () => {
    git('checkout', 'main')
    git('tag', 'merge-shared')
    await runOp(createBranch(repoDir, 'merge-shared', undefined, true))
    commitFile('branch-only.txt', 'branch\n', 'branch work')
    git('checkout', 'main')

    await runOp(mergeBranch(repoDir, 'local', 'merge-shared'))

    expect(fs.existsSync(path.join(repoDir, 'branch-only.txt'))).toBe(true)
  })

  it('merges the selected remote ref when a local branch has the same full path', async () => {
    git('checkout', 'main')
    git('checkout', '-b', 'remote-source')
    commitFile('remote-only.txt', 'remote\n', 'remote work')
    const remoteTip = git('rev-parse', 'HEAD').trim()
    git('checkout', 'main')
    git('branch', 'origin/collision')
    git('update-ref', 'refs/remotes/origin/collision', remoteTip)

    await runOp(mergeBranch(repoDir, 'remote', 'origin/collision'))

    expect(fs.existsSync(path.join(repoDir, 'remote-only.txt'))).toBe(true)
  })
})

describe('reset', () => {
  it('resets the current branch to a commit with the chosen mode', async () => {
    git('checkout', 'main')
    await runOp(createBranch(repoDir, 'reset/target', undefined, true))
    commitFile('reset.txt', 'first\n', 'first')
    const headBefore = git('rev-parse', 'HEAD').trim()
    commitFile('reset.txt', 'second\n', 'second')

    await runOp(resetToCommit(repoDir, headBefore, 'soft'))
    expect(git('rev-parse', 'HEAD').trim()).toBe(headBefore)
    expect(readFile('reset.txt')).toBe('second\n')

    await runOp(resetToCommit(repoDir, headBefore, 'hard'))
    expect(readFile('reset.txt')).toBe('first\n')
    git('checkout', 'main')
  })
})

describe('revert and cherry-pick', () => {
  it('reverts a commit', async () => {
    git('checkout', 'main')
    await runOp(createBranch(repoDir, 'revert/target', undefined, true))
    commitFile('revert.txt', 'added\n', 'add revert file')
    const target = git('rev-parse', 'HEAD').trim()
    await runOp(revertCommit(repoDir, target))
    expect(fs.existsSync(path.join(repoDir, 'revert.txt'))).toBe(false)
    git('checkout', 'main')
  })

  it('cherry-picks a commit from another branch', async () => {
    git('checkout', 'main')
    await runOp(createBranch(repoDir, 'pick/source', undefined, true))
    commitFile('pick.txt', 'picked\n', 'pick this commit')
    const source = git('rev-parse', 'HEAD').trim()
    git('checkout', 'main')
    await runOp(cherryPick(repoDir, source))
    expect(readFile('pick.txt')).toBe('picked\n')
  })
})

describe('tags', () => {
  it('creates a lightweight tag and an annotated tag, then deletes one', async () => {
    git('checkout', 'main')
    await runOp(createTag(repoDir, 'v-light'))
    await runOp(createTag(repoDir, 'v-annotated', undefined, 'release notes'))

    const refs = await runOp(getRemoteRefs(repoDir))
    expect(refs.refs.tags.includes('v-light')).toBe(true)
    expect(refs.refs.tags.includes('v-annotated')).toBe(true)
    expect(git('cat-file', '-t', 'v-annotated').trim()).toBe('tag')

    await runOp(deleteTag(repoDir, 'v-light'))
    const after = await runOp(getRemoteRefs(repoDir))
    expect(after.refs.tags.includes('v-light')).toBe(false)
  })

  it('creates a tag at the selected local branch when a tag has the same name', async () => {
    git('checkout', 'main')
    git('tag', 'shared-source')
    await runOp(createBranch(repoDir, 'shared-source', undefined, true))
    commitFile('shared-source.txt', 'branch tip\n', 'branch tip')
    const branchTip = git('rev-parse', 'HEAD').trim()
    git('checkout', 'main')

    await runOp(createTag(repoDir, 'from-local', 'shared-source', undefined, 'local'))

    expect(git('rev-parse', 'from-local^{}').trim()).toBe(branchTip)
  })
})

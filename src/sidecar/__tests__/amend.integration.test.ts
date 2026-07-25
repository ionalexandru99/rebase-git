import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Effect, Either } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { amendCommit, casAdvanceHead, closeRepo, getHeadCommit, openRepo } from '../operations'
import { runOp } from './run-op'

let repoDir: string

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

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

function amendCurrent(
  message: string,
  droppedHeadPaths: string[] = [],
  droppedHeadHunks: { file: string; hunks: string[] }[] = []
) {
  return amendCommit(
    repoDir,
    message,
    droppedHeadPaths,
    droppedHeadHunks,
    git('rev-parse', 'HEAD').trim()
  )
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

    await runOp(amendCurrent('reworded subject\n\nwith a body'))

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

    await runOp(amendCurrent('second reworded'))

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

    await runOp(amendCurrent('merge feature (reworded)'))

    expect(parentsOf()).toEqual(parentsBefore)
    expect(show('%s')).toBe('merge feature (reworded)')
  })

  it('keeps a root commit parentless', async () => {
    commitFile('only.txt', 'root\n', 'root commit')
    expect(parentsOf()).toHaveLength(0)

    await runOp(amendCurrent('root reworded'))

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

    expect(head.result.sha).toBe(git('rev-parse', 'HEAD').trim())
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

  // Win32 forbids control characters in filenames, so only the unicode case is creatable there.
  it('returns tab, newline, and unicode file names without quoting or truncation', async () => {
    commitFile('base.txt', 'base\n', 'base')
    const names =
      process.platform === 'win32' ? ['café.txt'] : ['tab\tname.txt', 'line\nbreak.txt', 'café.txt']
    for (const name of names) {
      fs.writeFileSync(path.join(repoDir, name), name)
    }
    git('add', '.')
    git('commit', '-m', 'unusual names')

    const head = await runOp(getHeadCommit(repoDir))

    expect(head.result.files.map((file) => file.path).sort()).toEqual(names.sort())
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

    await runOp(amendCurrent('second', ['a.txt']))

    expect(git('show', 'HEAD:a.txt')).toBe('base\n')
    expect(workingTree('a.txt')).toBe('changed\n')
    expect(git('status', '--porcelain').trim()).toBe('M a.txt')
    expect(git('rev-parse', 'HEAD~1').trim()).toBe(baseSha)
  })

  it('removes a dropped addition from the commit, leaving it as an untracked working file', async () => {
    commitFile('base.txt', 'base\n', 'base')
    const baseSha = git('rev-parse', 'HEAD').trim()
    commitFile('new.txt', 'new\n', 'second')

    await runOp(amendCurrent('second', ['new.txt']))

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

    await runOp(amendCurrent('second', ['del.txt']))

    expect(git('show', 'HEAD:del.txt')).toBe('content\n')
    expect(fs.existsSync(path.join(repoDir, 'del.txt'))).toBe(false)
    expect(git('status', '--porcelain').trim()).toBe('D del.txt')
    expect(git('rev-parse', 'HEAD~1').trim()).toBe(baseSha)
  })

  it('restores a renamed file at its parent path when the rename is dropped', async () => {
    // Both names carry glob metacharacters so the rename exercises literal pathspecs;
    // `[` and `]` are the only such characters Win32 permits in a filename.
    const source = 'old [source].txt'
    const destination = 'new [dest].txt'
    commitFile(source, 'renamed contents\n', 'base')
    git('mv', source, destination)
    git('commit', '-m', 'rename file')
    const head = await runOp(getHeadCommit(repoDir))
    const renamed = head.result.files.find((file) => file.status.startsWith('R'))
    const renameSource = renamed?.renameSource

    await runOp(
      amendCurrent(
        'rename file',
        renamed ? (renameSource ? [renameSource, renamed.path] : [renamed.path]) : []
      )
    )

    expect(git('show', `HEAD:${source}`)).toBe('renamed contents\n')
    expect(git('ls-tree', '--name-only', 'HEAD').trim().split('\n')).toEqual([source])
    expect(fs.existsSync(path.join(repoDir, source))).toBe(false)
    expect(workingTree(destination)).toBe('renamed contents\n')
  })

  it('drops a file from a root commit (the absent parent means it is removed)', async () => {
    fs.writeFileSync(path.join(repoDir, 'keep.txt'), 'keep\n')
    fs.writeFileSync(path.join(repoDir, 'drop.txt'), 'drop\n')
    git('add', '.')
    git('commit', '-m', 'root')

    await runOp(amendCurrent('root', ['drop.txt']))

    expect(parentsOf()).toHaveLength(0)
    expect(git('show', 'HEAD:keep.txt')).toBe('keep\n')
    expect(() => git('show', 'HEAD:drop.txt')).toThrow()
    expect(workingTree('drop.txt')).toBe('drop\n')
    expect(git('status', '--porcelain').trim()).toBe('?? drop.txt')
  })

  it('rolls HEAD back and preserves staged state when the prepared index cannot be installed', {
    timeout: 15000
  }, async () => {
    commitFile('locked.txt', 'base\n', 'base')
    commitFile('locked.txt', 'changed\n', 'second')
    const headBefore = git('rev-parse', 'HEAD').trim()
    fs.writeFileSync(path.join(repoDir, 'staged.txt'), 'staged\n')
    git('add', 'staged.txt')
    const stagedOid = git('rev-parse', ':staged.txt').trim()
    const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
    const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-amend-git-'))
    const gitWrapper = path.join(fakeBin, 'git')
    const indexPath = path.join(repoDir, '.git', 'index')
    const savedIndexPath = path.join(fakeBin, 'saved-index')
    const sabotagedMarker = path.join(fakeBin, 'sabotaged')
    fs.writeFileSync(
      gitWrapper,
      `#!/bin/sh\ncase " $* " in *" update-ref -m amend: rewrite HEAD HEAD "*) "${realGit}" "$@"; status=$?; if [ "$status" -eq 0 ] && [ ! -e "${sabotagedMarker}" ]; then touch "${sabotagedMarker}"; mv "${indexPath}" "${savedIndexPath}"; mkdir "${indexPath}"; fi; exit "$status";; esac\nexec "${realGit}" "$@"\n`
    )
    fs.chmodSync(gitWrapper, 0o755)
    const previousPath = process.env.PATH
    process.env.PATH = `${fakeBin}:${previousPath ?? ''}`

    try {
      const outcome = await runOp(
        Effect.either(amendCommit(repoDir, 'second', ['locked.txt'], [], headBefore))
      )
      expect(Either.isLeft(outcome)).toBe(true)
      expect(git('rev-parse', 'HEAD').trim()).toBe(headBefore)
      fs.rmdirSync(indexPath)
      fs.renameSync(savedIndexPath, indexPath)
      expect(git('rev-parse', ':staged.txt').trim()).toBe(stagedOid)
    } finally {
      if (fs.existsSync(savedIndexPath)) {
        fs.rmSync(indexPath, { recursive: true, force: true })
        fs.renameSync(savedIndexPath, indexPath)
      }
      process.env.PATH = previousPath
      fs.rmSync(fakeBin, { recursive: true, force: true })
    }
  })

  it('repairs the index and reports the landed amend if index install and HEAD rollback fail', {
    timeout: 15000
  }, async () => {
    commitFile('landed.txt', 'base\n', 'base')
    commitFile('landed.txt', 'changed\n', 'second')
    const headBefore = git('rev-parse', 'HEAD').trim()
    fs.writeFileSync(path.join(repoDir, 'landed.txt'), 'staged next\n')
    git('add', 'landed.txt')
    const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
    const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-amend-git-'))
    const gitWrapper = path.join(fakeBin, 'git')
    const updateCount = path.join(fakeBin, 'update-count')
    const indexPath = path.join(repoDir, '.git', 'index')
    const savedIndexPath = path.join(fakeBin, 'saved-index')
    fs.writeFileSync(
      gitWrapper,
      `#!/bin/sh\ncase " $* " in *" update-ref -m amend: rewrite HEAD HEAD "*) count=$(($(cat "${updateCount}" 2>/dev/null || echo 0) + 1)); echo "$count" > "${updateCount}"; if [ "$count" -gt 1 ]; then rmdir "${indexPath}"; mv "${savedIndexPath}" "${indexPath}"; exit 74; fi; "${realGit}" "$@"; status=$?; if [ "$status" -eq 0 ]; then mv "${indexPath}" "${savedIndexPath}"; mkdir "${indexPath}"; fi; exit "$status";; esac\nexec "${realGit}" "$@"\n`
    )
    fs.chmodSync(gitWrapper, 0o755)
    const previousPath = process.env.PATH
    process.env.PATH = `${fakeBin}:${previousPath ?? ''}`

    try {
      const outcome = await runOp(
        Effect.either(amendCommit(repoDir, 'second', ['landed.txt'], [], headBefore))
      )
      expect(Either.isRight(outcome)).toBe(true)
      if (Either.isRight(outcome)) {
        expect(outcome.right.result.commit).toBe(git('rev-parse', 'HEAD').trim())
      }
      expect(git('rev-parse', 'HEAD').trim()).not.toBe(headBefore)
      expect(git('show', 'HEAD:landed.txt')).toBe('base\n')
      expect(git('show', ':landed.txt')).toBe('base\n')
      expect(workingTree('landed.txt')).toBe('staged next\n')
      expect(git('status', '--porcelain')).toBe(' M landed.txt\n')
    } finally {
      if (fs.existsSync(savedIndexPath)) {
        fs.rmSync(indexPath, { recursive: true, force: true })
        fs.renameSync(savedIndexPath, indexPath)
      }
      process.env.PATH = previousPath
      fs.rmSync(fakeBin, { recursive: true, force: true })
    }
  })

  it('reports a landed amend as unsafe to retry if independent index repair fails', {
    timeout: 15000
  }, async () => {
    commitFile('unrecovered.txt', 'base\n', 'base')
    commitFile('unrecovered.txt', 'changed\n', 'second')
    const headBefore = git('rev-parse', 'HEAD').trim()
    const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
    const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-amend-git-'))
    const gitWrapper = path.join(fakeBin, 'git')
    const updateCount = path.join(fakeBin, 'update-count')
    const rollbackFailed = path.join(fakeBin, 'rollback-failed')
    const indexPath = path.join(repoDir, '.git', 'index')
    const savedIndexPath = path.join(fakeBin, 'saved-index')
    fs.writeFileSync(
      gitWrapper,
      `#!/bin/sh\ncase " $* " in *" update-ref -m amend: rewrite HEAD HEAD "*) count=$(($(cat "${updateCount}" 2>/dev/null || echo 0) + 1)); echo "$count" > "${updateCount}"; if [ "$count" -gt 1 ]; then rmdir "${indexPath}"; mv "${savedIndexPath}" "${indexPath}"; touch "${rollbackFailed}"; exit 74; fi; "${realGit}" "$@"; status=$?; if [ "$status" -eq 0 ]; then mv "${indexPath}" "${savedIndexPath}"; mkdir "${indexPath}"; fi; exit "$status";; esac\ncase " $* " in *" read-tree "*) if [ -e "${rollbackFailed}" ]; then exit 75; fi;; esac\nexec "${realGit}" "$@"\n`
    )
    fs.chmodSync(gitWrapper, 0o755)
    const previousPath = process.env.PATH
    process.env.PATH = `${fakeBin}:${previousPath ?? ''}`

    try {
      const outcome = await runOp(
        Effect.either(amendCommit(repoDir, 'second', ['unrecovered.txt'], [], headBefore))
      )
      expect(Either.isLeft(outcome)).toBe(true)
      if (Either.isLeft(outcome)) {
        expect(outcome.left._tag).toBe('GitError')
        if (outcome.left._tag === 'GitError') {
          expect(outcome.left.message).toContain('landed')
          expect(outcome.left.message).toContain('Do not retry the amend')
        }
      }
      expect(git('rev-parse', 'HEAD').trim()).not.toBe(headBefore)
      expect(git('write-tree').trim()).not.toBe(show('%T'))
    } finally {
      if (fs.existsSync(savedIndexPath)) {
        fs.rmSync(indexPath, { recursive: true, force: true })
        fs.renameSync(savedIndexPath, indexPath)
      }
      process.env.PATH = previousPath
      fs.rmSync(fakeBin, { recursive: true, force: true })
    }
  })

  it('surfaces a staged same-file change after dropping that file from HEAD', async () => {
    commitFile('same.txt', 'base\n', 'base')
    commitFile('same.txt', 'committed\n', 'second')
    fs.writeFileSync(path.join(repoDir, 'same.txt'), 'staged next\n')
    git('add', 'same.txt')

    await runOp(amendCurrent('second', ['same.txt']))

    expect(git('show', 'HEAD:same.txt')).toBe('base\n')
    expect(git('show', ':same.txt')).toBe('base\n')
    expect(workingTree('same.txt')).toBe('staged next\n')
    expect(git('status', '--porcelain')).toBe(' M same.txt\n')
  })
})

describe('amendCommit — SHA-256 repository', () => {
  it('drops a root-commit hunk using the repository object format', {
    timeout: 15000
  }, async () => {
    const base = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-amend-sha256-'))
    )
    const sha256Repo = path.join(base, 'repo')
    fs.mkdirSync(sha256Repo)
    execFileSync('git', ['-C', sha256Repo, 'init', '--object-format=sha256', '-b', 'main'])
    execFileSync('git', ['-C', sha256Repo, 'config', 'user.email', 'test@example.com'])
    execFileSync('git', ['-C', sha256Repo, 'config', 'user.name', 'Test'])
    fs.writeFileSync(
      path.join(sha256Repo, 'root.txt'),
      'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\neleven\ntwelve\nthirteen\n'
    )
    execFileSync('git', ['-C', sha256Repo, 'add', '.'])
    execFileSync('git', ['-C', sha256Repo, 'commit', '-m', 'root'])
    await runOp(openRepo(sha256Repo))

    try {
      const emptyTree = execFileSync('git', ['-C', sha256Repo, 'mktree'], {
        encoding: 'utf8',
        input: ''
      }).trim()
      const rootDiff = execFileSync(
        'git',
        ['-C', sha256Repo, 'diff', '--unified=3', emptyTree, 'HEAD', '--', 'root.txt'],
        { encoding: 'utf8' }
      )
      const hunkHeader = rootDiff.split('\n').find((line) => line.startsWith('@@ '))
      expect(hunkHeader).toBeDefined()

      const expectedHead = execFileSync('git', ['-C', sha256Repo, 'rev-parse', 'HEAD'], {
        encoding: 'utf8'
      }).trim()
      await runOp(
        amendCommit(
          sha256Repo,
          'root',
          [],
          [{ file: 'root.txt', hunks: [hunkHeader ?? ''] }],
          expectedHead
        )
      )
      expect(() => execFileSync('git', ['-C', sha256Repo, 'show', 'HEAD:root.txt'])).toThrow()
      expect(fs.existsSync(path.join(sha256Repo, 'root.txt'))).toBe(true)
    } finally {
      await runOp(closeRepo(sha256Repo))
      fs.rmSync(base, { recursive: true, force: true })
    }
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

    await runOp(amendCurrent('second', [], [{ file: 'multi.txt', hunks: [headers[0]] }]))

    const committed = git('show', 'HEAD:multi.txt')
    expect(committed.split('\n')[0]).toBe('a1')
    expect(committed.trimEnd().split('\n').at(-1)).toBe('A13')
    expect(workingTree('multi.txt')).toBe(head)
    expect(git('status', '--porcelain').trim()).toBe('M multi.txt')
    expect(git('rev-parse', 'HEAD~1').trim()).toBe(baseSha)
  })

  it('rejects a stale hunk drop with HunkNotFound, leaving HEAD and the worktree untouched', async () => {
    commitFile('stale.txt', 'before\n', 'base')
    commitFile('stale.txt', 'after\n', 'second')
    const headBefore = git('rev-parse', 'HEAD').trim()

    const outcome = await runOp(
      Effect.either(
        amendCurrent('second', [], [{ file: 'stale.txt', hunks: ['@@ -99,1 +99,1 @@ stale'] }])
      )
    )

    expect(Either.isLeft(outcome)).toBe(true)
    if (Either.isLeft(outcome)) {
      expect(outcome.left._tag).toBe('HunkNotFound')
    }
    expect(git('rev-parse', 'HEAD').trim()).toBe(headBefore)
    expect(show('%s')).toBe('second')
    expect(git('status', '--porcelain').trim()).toBe('')
    expect(workingTree('stale.txt')).toBe('after\n')
  })
})

function gitDirPath(...segments: string[]): string {
  return path.join(repoDir, '.git', ...segments)
}

async function expectAmendBlocked(
  operation: 'merge' | 'cherry-pick' | 'revert' | 'rebase',
  droppedPaths: string[] = []
): Promise<void> {
  const headBefore = git('rev-parse', 'HEAD').trim()
  const outcome = await runOp(Effect.either(amendCurrent('rewritten', droppedPaths)))
  expect(Either.isLeft(outcome)).toBe(true)
  if (Either.isLeft(outcome)) {
    expect(outcome.left._tag).toBe('OperationInProgress')
    expect((outcome.left as { operation?: string }).operation).toBe(operation)
  }
  expect(git('rev-parse', 'HEAD').trim()).toBe(headBefore)
}

function setupMergeConflict(): void {
  commitFile('conflict.txt', 'base\n', 'base')
  git('checkout', '-b', 'other')
  commitFile('conflict.txt', 'other-side\n', 'other side')
  git('checkout', 'main')
  commitFile('conflict.txt', 'main-side\n', 'main side')
  expect(() => git('merge', 'other')).toThrow()
  expect(fs.existsSync(gitDirPath('MERGE_HEAD'))).toBe(true)
}

describe('amendCommit — in-progress operation guard', () => {
  it('refuses to amend mid-merge and leaves MERGE_HEAD in place', async () => {
    setupMergeConflict()

    await expectAmendBlocked('merge')

    expect(fs.existsSync(gitDirPath('MERGE_HEAD'))).toBe(true)
  })

  it('refuses a destage (dropped paths) mid-merge even with the resolution staged', async () => {
    setupMergeConflict()
    fs.writeFileSync(path.join(repoDir, 'conflict.txt'), 'resolved\n')
    git('add', 'conflict.txt')

    await expectAmendBlocked('merge', ['conflict.txt'])

    expect(fs.existsSync(gitDirPath('MERGE_HEAD'))).toBe(true)
  })

  it('refuses to amend mid-cherry-pick and leaves CHERRY_PICK_HEAD in place', async () => {
    commitFile('pick.txt', 'base\n', 'base')
    git('checkout', '-b', 'pick-source')
    commitFile('pick.txt', 'branch-side\n', 'branch change')
    const pickSha = git('rev-parse', 'HEAD').trim()
    git('checkout', 'main')
    commitFile('pick.txt', 'main-side\n', 'main change')
    expect(() => git('cherry-pick', pickSha)).toThrow()
    expect(fs.existsSync(gitDirPath('CHERRY_PICK_HEAD'))).toBe(true)

    await expectAmendBlocked('cherry-pick')

    expect(fs.existsSync(gitDirPath('CHERRY_PICK_HEAD'))).toBe(true)
  })

  it('refuses to amend mid-revert and leaves REVERT_HEAD in place', async () => {
    commitFile('revert.txt', 'one\n', 'first')
    commitFile('revert.txt', 'two\n', 'second')
    const middleSha = git('rev-parse', 'HEAD').trim()
    commitFile('revert.txt', 'three\n', 'third')
    expect(() => git('revert', '--no-edit', middleSha)).toThrow()
    expect(fs.existsSync(gitDirPath('REVERT_HEAD'))).toBe(true)

    await expectAmendBlocked('revert')

    expect(fs.existsSync(gitDirPath('REVERT_HEAD'))).toBe(true)
  })

  it('refuses to amend mid-rebase (merge backend) and leaves rebase-merge in place', async () => {
    commitFile('rebase.txt', 'base\n', 'base')
    git('checkout', '-b', 'rebase-branch')
    commitFile('rebase.txt', 'branch-side\n', 'branch change')
    git('checkout', 'main')
    commitFile('rebase.txt', 'main-side\n', 'main change')
    git('checkout', 'rebase-branch')
    expect(() => git('rebase', 'main')).toThrow()
    expect(fs.existsSync(gitDirPath('rebase-merge'))).toBe(true)

    await expectAmendBlocked('rebase')

    expect(fs.existsSync(gitDirPath('rebase-merge'))).toBe(true)
  })

  it('refuses to amend mid-rebase (apply backend) and leaves rebase-apply in place', async () => {
    commitFile('rebase.txt', 'base\n', 'base')
    git('checkout', '-b', 'apply-branch')
    commitFile('rebase.txt', 'branch-side\n', 'branch change')
    git('checkout', 'main')
    commitFile('rebase.txt', 'main-side\n', 'main change')
    git('checkout', 'apply-branch')
    expect(() => git('rebase', '--apply', 'main')).toThrow()
    expect(fs.existsSync(gitDirPath('rebase-apply'))).toBe(true)

    await expectAmendBlocked('rebase')

    expect(fs.existsSync(gitDirPath('rebase-apply'))).toBe(true)
  })

  it('amends normally again once the merge is aborted', async () => {
    setupMergeConflict()
    git('merge', '--abort')

    await runOp(amendCurrent('main side reworded'))

    expect(show('%s')).toBe('main side reworded')
  })
})

describe('amendCommit — compare-and-swap', () => {
  it('refuses an amend when HEAD differs from the caller-observed commit', async () => {
    commitFile('x.txt', 'a\n', 'first')
    const observed = git('rev-parse', 'HEAD').trim()
    commitFile('x.txt', 'b\n', 'second')
    const current = git('rev-parse', 'HEAD').trim()

    const outcome = await runOp(
      Effect.either(amendCommit(repoDir, 'stale rewrite', [], [], observed))
    )

    expect(Either.isLeft(outcome)).toBe(true)
    if (Either.isLeft(outcome)) {
      expect(outcome.left._tag).toBe('AmendRejected')
    }
    expect(git('rev-parse', 'HEAD').trim()).toBe(current)
    expect(show('%s')).toBe('second')
  })

  it('amends when expectedHead matches the current HEAD', async () => {
    commitFile('x.txt', 'a\n', 'first')
    commitFile('x.txt', 'b\n', 'second')
    const observed = git('rev-parse', 'HEAD').trim()

    await runOp(amendCommit(repoDir, 'second reworded', [], [], observed))

    expect(show('%s')).toBe('second reworded')
    expect(git('rev-parse', 'HEAD').trim()).not.toBe(observed)
  })

  it('refuses a stale destage (dropped paths) before touching the index', async () => {
    commitFile('x.txt', 'a\n', 'first')
    const observed = git('rev-parse', 'HEAD').trim()
    commitFile('x.txt', 'b\n', 'second')
    const current = git('rev-parse', 'HEAD').trim()

    const outcome = await runOp(
      Effect.either(amendCommit(repoDir, 'second', ['x.txt'], [], observed))
    )

    expect(Either.isLeft(outcome)).toBe(true)
    if (Either.isLeft(outcome)) {
      expect(outcome.left._tag).toBe('AmendRejected')
    }
    expect(git('rev-parse', 'HEAD').trim()).toBe(current)
    expect(git('status', '--porcelain').trim()).toBe('')
  })

  it('preserves a staged same-file change when HEAD moves during a dropped-file amend', {
    timeout: 15000
  }, async () => {
    commitFile('same.txt', 'base\n', 'base')
    commitFile('same.txt', 'committed\n', 'second')
    const observed = git('rev-parse', 'HEAD').trim()
    fs.writeFileSync(path.join(repoDir, 'same.txt'), 'staged next\n')
    git('add', 'same.txt')
    const stagedOid = git('rev-parse', ':same.txt').trim()
    const external = git('commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'external move').trim()
    const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
    const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-amend-git-'))
    const gitWrapper = path.join(fakeBin, 'git')
    const movedMarker = path.join(fakeBin, 'moved')
    fs.writeFileSync(
      gitWrapper,
      `#!/bin/sh\ncase " $* " in *" update-ref -m amend: rewrite HEAD HEAD "*) if [ ! -e "${movedMarker}" ]; then touch "${movedMarker}"; "${realGit}" -C "${repoDir}" update-ref refs/heads/main "${external}"; fi;; esac\nexec "${realGit}" "$@"\n`
    )
    fs.chmodSync(gitWrapper, 0o755)
    const previousPath = process.env.PATH
    process.env.PATH = `${fakeBin}:${previousPath ?? ''}`

    try {
      const outcome = await runOp(
        Effect.either(amendCommit(repoDir, 'second', ['same.txt'], [], observed))
      )

      expect(Either.isLeft(outcome)).toBe(true)
      if (Either.isLeft(outcome)) {
        expect(outcome.left._tag).toBe('AmendRejected')
      }
      expect(git('rev-parse', 'HEAD').trim()).toBe(external)
      expect(git('rev-parse', ':same.txt').trim()).toBe(stagedOid)
      expect(workingTree('same.txt')).toBe('staged next\n')
    } finally {
      process.env.PATH = previousPath
      fs.rmSync(fakeBin, { recursive: true, force: true })
    }
  })

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

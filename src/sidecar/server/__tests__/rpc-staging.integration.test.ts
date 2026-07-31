import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { RpcTest } from '@effect/rpc'
import { HunkNotFound } from '@shared/git-rpc-errors'
import { fingerprintHunk } from '@shared/hunk-fingerprint'
import { SidecarRpcs } from '@shared/rpc'
import { parseUnifiedDiff } from '@shared/unified-diff'
import { Effect, Either } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  closeRepo,
  getDiff,
  getStatus,
  openRepo,
  unstageAll,
  unstageFile
} from '../../operations/index'
import { makeGit } from '../../test-support/git-cli'
import { runOp } from '../../test-support/run-op'
import { handlersLayer } from '../handlers'

let repoDir: string
let git: ReturnType<typeof makeGit>

function write(name: string, contents: string): void {
  fs.writeFileSync(path.join(repoDir, name), contents)
}

function expectUnbornHead(repoPath: string): void {
  const result = spawnSync('git', ['-C', repoPath, 'rev-parse', '--verify', '--quiet', 'HEAD'])
  expect(result.status).not.toBe(0)
}

const stageFileThroughGroup = (payload: { repoPath: string; file: string }) =>
  runOp(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SidecarRpcs)
      return yield* Effect.either(client.stageFile(payload))
    }).pipe(Effect.scoped, Effect.provide(handlersLayer))
  )

const stageHunkThroughGroup = (payload: { repoPath: string; file: string; hunkHeader: string }) =>
  runOp(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SidecarRpcs)
      return yield* Effect.either(client.stageHunk(payload))
    }).pipe(Effect.scoped, Effect.provide(handlersLayer))
  )

const discardHunkThroughGroup = (payload: { repoPath: string; file: string; hunkHeader: string }) =>
  runOp(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SidecarRpcs)
      return yield* Effect.either(client.discardHunk(payload))
    }).pipe(Effect.scoped, Effect.provide(handlersLayer))
  )

const unstageFileThroughGroup = (payload: {
  repoPath: string
  file: string
  renameSource?: string
}) =>
  runOp(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(SidecarRpcs)
      return yield* Effect.either(client.unstageFile(payload))
    }).pipe(Effect.scoped, Effect.provide(handlersLayer))
  )

beforeAll(async () => {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-rpc-stage-')))
  repoDir = path.join(base, 'repo')
  fs.mkdirSync(repoDir)
  git = makeGit(repoDir)
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

describe('staging through the RPC group against a real repo', () => {
  it('stages a new file and surfaces a void Ok success', async () => {
    write('new.txt', 'fresh\n')
    const result = await stageFileThroughGroup({ repoPath: repoDir, file: 'new.txt' })
    expect(Either.isRight(result)).toBe(true)

    const status = await runOp(getStatus(repoDir))
    expect(status.status.staged).toContain('new.txt')
  })

  it('returns a typed HunkNotFound when the hunk header matches nothing', async () => {
    write('tracked.txt', 'changed\n')
    const result = await stageHunkThroughGroup({
      repoPath: repoDir,
      file: 'tracked.txt',
      hunkHeader: '@@ -999,1 +999,1 @@ no such hunk'
    })
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(HunkNotFound)
    }
  })

  it('stages a single selected line through the RPC group', async () => {
    git('reset', '--hard', 'HEAD')
    git('clean', '-fd')
    write('tracked.txt', 'base\nfirst-added\nsecond-added\n')

    try {
      const { patch } = await runOp(getDiff(repoDir, 'tracked.txt', false))
      const hunk = parseUnifiedDiff(patch).hunks[0]
      const lineIndexes = hunk.lines.flatMap((line, index) =>
        line.kind === 'add' && line.text === 'first-added' ? [index] : []
      )
      const fingerprint = fingerprintHunk(patch, hunk.header)
      expect(fingerprint).not.toBeNull()

      const result = await runOp(
        Effect.gen(function* () {
          const client = yield* RpcTest.makeClient(SidecarRpcs)
          return yield* Effect.either(
            client.stageLines({
              repoPath: repoDir,
              file: 'tracked.txt',
              selections: [
                { hunkHeader: hunk.header, lineIndexes, fingerprint: fingerprint as string }
              ]
            })
          )
        }).pipe(Effect.scoped, Effect.provide(handlersLayer))
      )

      expect(Either.isRight(result)).toBe(true)
      expect(git('show', ':tracked.txt')).toBe('base\nfirst-added\n')
    } finally {
      git('reset', '--hard', 'HEAD')
      git('clean', '-fd')
    }
  })

  it('returns a typed HunkNotFound from unstageLines for a stale selection', async () => {
    const result = await runOp(
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(SidecarRpcs)
        return yield* Effect.either(
          client.unstageLines({
            repoPath: repoDir,
            file: 'tracked.txt',
            selections: [
              { hunkHeader: '@@ -999,1 +999,1 @@', lineIndexes: [0], fingerprint: '00000000' }
            ]
          })
        )
      }).pipe(Effect.scoped, Effect.provide(handlersLayer))
    )
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(HunkNotFound)
    }
  })

  it('discards a worktree hunk through the RPC group and restores the committed content', async () => {
    git('reset', '--hard', 'HEAD')
    git('clean', '-fd')
    write('tracked.txt', 'changed\n')

    try {
      const { patch } = await runOp(getDiff(repoDir, 'tracked.txt', false))
      const hunks = parseUnifiedDiff(patch).hunks
      expect(hunks).toHaveLength(1)

      const result = await discardHunkThroughGroup({
        repoPath: repoDir,
        file: 'tracked.txt',
        hunkHeader: hunks[0].header
      })

      expect(Either.isRight(result)).toBe(true)
      expect(fs.readFileSync(path.join(repoDir, 'tracked.txt'), 'utf8')).toBe('base\n')
    } finally {
      git('reset', '--hard', 'HEAD')
      git('clean', '-fd')
    }
  })

  it('retries bounded transient index.lock contention', async () => {
    write('retry.txt', 'retry\n')
    const indexLock = path.join(repoDir, '.git', 'index.lock')
    fs.writeFileSync(indexLock, 'busy')
    const release = setTimeout(() => fs.rmSync(indexLock, { force: true }), 40)

    try {
      const result = await stageFileThroughGroup({ repoPath: repoDir, file: 'retry.txt' })

      expect(Either.isRight(result)).toBe(true)
      expect(git('diff', '--cached', '--name-only')).toContain('retry.txt')
    } finally {
      clearTimeout(release)
      fs.rmSync(indexLock, { force: true })
    }
  })

  it('unstages both paths of a staged rename', async () => {
    git('reset', '--hard', 'HEAD')
    git('clean', '-fd')
    write('rename-source.txt', 'renamed contents\n')
    git('add', 'rename-source.txt')
    git('commit', '-m', 'add rename source')
    git('mv', 'rename-source.txt', 'rename-destination.txt')

    try {
      const result = await unstageFileThroughGroup({
        repoPath: repoDir,
        file: 'rename-destination.txt',
        renameSource: 'rename-source.txt'
      })

      expect(Either.isRight(result)).toBe(true)
      expect(git('diff', '--cached', '--name-status').trim()).toBe('')
      expect(git('diff', '--name-status').trim()).toBe('D\trename-source.txt')
      expect(git('ls-files', '--others', '--exclude-standard').trim()).toBe(
        'rename-destination.txt'
      )
      expect(fs.existsSync(path.join(repoDir, 'rename-source.txt'))).toBe(false)
      expect(fs.readFileSync(path.join(repoDir, 'rename-destination.txt'), 'utf8')).toBe(
        'renamed contents\n'
      )
    } finally {
      git('reset', '--hard', 'HEAD')
      git('clean', '-fd')
    }
  })
})

describe('unstaging in a repository with unborn HEAD', () => {
  it('unstageFile empties the index without deleting the working file', async () => {
    const base = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-unstage-unborn-'))
    )
    const unbornRepo = path.join(base, 'repo')
    fs.mkdirSync(unbornRepo)
    execFileSync('git', ['-C', unbornRepo, 'init', '-b', 'main'])
    fs.writeFileSync(path.join(unbornRepo, 'one.txt'), 'one\n')
    execFileSync('git', ['-C', unbornRepo, 'add', '.'])
    await runOp(openRepo(unbornRepo))

    try {
      expectUnbornHead(unbornRepo)
      await runOp(unstageFile(unbornRepo, 'one.txt'))
      expect(
        execFileSync('git', ['-C', unbornRepo, 'ls-files', '--stage'], { encoding: 'utf8' })
      ).toBe('')
      expect(
        execFileSync('git', ['-C', unbornRepo, 'status', '--porcelain'], {
          encoding: 'utf8'
        }).trim()
      ).toBe('?? one.txt')
      expect(fs.readFileSync(path.join(unbornRepo, 'one.txt'), 'utf8')).toBe('one\n')
    } finally {
      await runOp(closeRepo(unbornRepo))
      fs.rmSync(base, { recursive: true, force: true })
    }
  })

  it('unstageAll empties the index without deleting working files', async () => {
    const base = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-unstage-all-unborn-'))
    )
    const unbornRepo = path.join(base, 'repo')
    fs.mkdirSync(unbornRepo)
    execFileSync('git', ['-C', unbornRepo, 'init', '-b', 'main'])
    fs.writeFileSync(path.join(unbornRepo, 'one.txt'), 'one\n')
    fs.writeFileSync(path.join(unbornRepo, 'two.txt'), 'two\n')
    execFileSync('git', ['-C', unbornRepo, 'add', '.'])
    await runOp(openRepo(unbornRepo))

    try {
      expectUnbornHead(unbornRepo)
      await runOp(unstageAll(unbornRepo, ['one.txt', 'two.txt']))
      expect(
        execFileSync('git', ['-C', unbornRepo, 'ls-files', '--stage'], { encoding: 'utf8' })
      ).toBe('')
      expect(
        execFileSync('git', ['-C', unbornRepo, 'status', '--porcelain'], {
          encoding: 'utf8'
        }).trim()
      ).toBe('?? one.txt\n?? two.txt')
      expect(fs.readFileSync(path.join(unbornRepo, 'one.txt'), 'utf8')).toBe('one\n')
      expect(fs.readFileSync(path.join(unbornRepo, 'two.txt'), 'utf8')).toBe('two\n')
    } finally {
      await runOp(closeRepo(unbornRepo))
      fs.rmSync(base, { recursive: true, force: true })
    }
  })
})

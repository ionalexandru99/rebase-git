import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Deferred, Effect, Fiber } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NotARepo, RepoNotOpen } from '../../git/errors'
import { closeRepo, openRepo } from '../../operations/index'
import { runOp } from '../../test-support/run-op'
import {
  closeSession,
  openSession,
  RepoSessions,
  RepoSessionsLive,
  requireGit,
  requireOpen,
  withSessionScope
} from '../sessions'

let baseDir: string
let repoDir: string

function git(dir: string, ...args: string[]): void {
  execFileSync('git', ['-C', dir, ...args])
}

beforeEach(() => {
  baseDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-sessions-test-')))
  repoDir = path.join(baseDir, 'repo')
  fs.mkdirSync(repoDir)
  git(repoDir, 'init', '-b', 'main')
  git(repoDir, 'config', 'user.email', 'test@example.com')
  git(repoDir, 'config', 'user.name', 'Test')
  fs.writeFileSync(path.join(repoDir, 'README.md'), '# test\n')
  git(repoDir, 'add', 'README.md')
  git(repoDir, 'commit', '-m', 'initial')
})

afterEach(async () => {
  await runOp(closeRepo(repoDir))
  // Closing kills the session's commit-graph write mid-flight, and Windows keeps a killed process's
  // files undeletable for a moment after it exits — long enough to fail this rm with EPERM.
  fs.rmSync(baseDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 })
})

describe('RepoSessions spine', () => {
  it('yields the open repo simple-git instance through requireGit after openRepo', async () => {
    const response = await runOp(openRepo(repoDir))
    expect(response.result.path).toBe(fs.realpathSync.native(repoDir))

    const instance = await runOp(requireGit(repoDir))
    const branch = await instance.revparse(['--abbrev-ref', 'HEAD'])
    expect(branch.trim()).toBe('main')
  })

  it('fails NotARepo for a non-repo path and leaves no session behind', async () => {
    const plainDir = path.join(baseDir, 'plain')
    fs.mkdirSync(plainDir)

    const opened = await runOp(Effect.either(openRepo(plainDir)))
    expect(opened._tag).toBe('Left')
    expect((opened as { left: unknown }).left).toBeInstanceOf(NotARepo)

    const required = await runOp(Effect.either(requireGit(plainDir)))
    expect(required._tag).toBe('Left')
    expect((required as { left: unknown }).left).toBeInstanceOf(RepoNotOpen)
  })

  it('fails requireGit and requireOpen with RepoNotOpen after close', async () => {
    await runOp(openRepo(repoDir))
    await runOp(closeRepo(repoDir))

    const git = await runOp(Effect.either(requireGit(repoDir)))
    expect(git._tag).toBe('Left')
    expect((git as { left: unknown }).left).toBeInstanceOf(RepoNotOpen)

    const open = await runOp(Effect.either(requireOpen(repoDir)))
    expect(open._tag).toBe('Left')
    expect((open as { left: unknown }).left).toBeInstanceOf(RepoNotOpen)
  })

  it('creates the session in open so requireGit later resolves the same instance', async () => {
    const created = await runOp(openSession(repoDir))
    const resolved = await runOp(requireGit(repoDir))
    expect(resolved).toBe(created)
  })

  it('removes abandoned amend indexes when a repo session opens', async () => {
    const gitDir = execFileSync('git', ['-C', repoDir, 'rev-parse', '--absolute-git-dir'], {
      encoding: 'utf8'
    }).trim()
    const staleIndex = path.join(gitDir, 'rebase-amend-index-12345')
    const unrelatedFile = path.join(gitDir, 'rebase-amend-state')
    fs.writeFileSync(staleIndex, 'stale')
    fs.writeFileSync(unrelatedFile, 'keep')

    await runOp(openSession(repoDir))

    expect(fs.existsSync(staleIndex)).toBe(false)
    expect(fs.readFileSync(unrelatedFile, 'utf8')).toBe('keep')
  })

  it('exposes the same session state through its Layer-provided service', async () => {
    const created = await runOp(openSession(repoDir))
    const viaService = await runOp(
      Effect.flatMap(RepoSessions, (sessions) => sessions.requireGit(repoDir)).pipe(
        Effect.provide(RepoSessionsLive)
      )
    )
    expect(viaService).toBe(created)
  })
})

describe('RepoSessions session scope', () => {
  it('runs a withSessionScope finalizer when the scoped effect completes', async () => {
    await runOp(openSession(repoDir))
    let released = false
    const probe = Effect.acquireRelease(Effect.succeed('resource'), () =>
      Effect.sync(() => {
        released = true
      })
    )

    await runOp(withSessionScope(repoDir, probe))

    expect(released).toBe(true)
  })

  it('force-runs an in-flight withSessionScope finalizer when the repo closes', async () => {
    await runOp(openSession(repoDir))
    let released = false

    await runOp(
      Effect.gen(function* () {
        const acquired = yield* Deferred.make<void>()
        const held = yield* Deferred.make<void>()
        const probe = Effect.acquireRelease(Deferred.succeed(acquired, undefined), () =>
          Effect.sync(() => {
            released = true
          })
        ).pipe(Effect.zipRight(Deferred.await(held)))

        const fiber = yield* Effect.fork(withSessionScope(repoDir, probe))
        yield* Deferred.await(acquired)
        yield* closeSession(repoDir)
        yield* Deferred.succeed(held, undefined)
        yield* Fiber.join(fiber)
      })
    )

    expect(released).toBe(true)
  })
})

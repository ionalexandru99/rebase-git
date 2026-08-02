import fs from 'node:fs'
import path from 'node:path'
import { Deferred, Effect, Fiber } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NotARepo, RepoNotOpen } from '../../git/errors'
import { closeRepo, openRepo } from '../../operations/index'
import {
  createRepoFixture,
  type RepoFixture,
  removeRepoDir
} from '../../test-support/repo-fixtures'
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

let repo: RepoFixture

beforeEach(() => {
  repo = createRepoFixture({ prefix: 'rebase-sessions-test-' })
  repo.write('README.md', '# test\n')
  repo.git('add', 'README.md')
  repo.commitStaged('initial')
})

afterEach(async () => {
  await runOp(closeRepo(repo.path))
  repo.cleanup()
  removeRepoDir(`${repo.path}-plain`)
})

describe('RepoSessions spine', () => {
  it('yields the open repo simple-git instance through requireGit after openRepo', async () => {
    const response = await runOp(openRepo(repo.path))
    expect(response.result.path).toBe(repo.path)

    const instance = await runOp(requireGit(repo.path))
    const branch = await instance.revparse(['--abbrev-ref', 'HEAD'])
    expect(branch.trim()).toBe('main')
  })

  it('fails NotARepo for a non-repo path and leaves no session behind', async () => {
    const plainDir = `${repo.path}-plain`
    fs.mkdirSync(plainDir)

    const opened = await runOp(Effect.either(openRepo(plainDir)))
    expect(opened._tag).toBe('Left')
    expect((opened as { left: unknown }).left).toBeInstanceOf(NotARepo)

    const required = await runOp(Effect.either(requireGit(plainDir)))
    expect(required._tag).toBe('Left')
    expect((required as { left: unknown }).left).toBeInstanceOf(RepoNotOpen)
  })

  it('fails requireGit and requireOpen with RepoNotOpen after close', async () => {
    await runOp(openRepo(repo.path))
    await runOp(closeRepo(repo.path))

    const git = await runOp(Effect.either(requireGit(repo.path)))
    expect(git._tag).toBe('Left')
    expect((git as { left: unknown }).left).toBeInstanceOf(RepoNotOpen)

    const open = await runOp(Effect.either(requireOpen(repo.path)))
    expect(open._tag).toBe('Left')
    expect((open as { left: unknown }).left).toBeInstanceOf(RepoNotOpen)
  })

  it('creates the session in open so requireGit later resolves the same instance', async () => {
    const created = await runOp(openSession(repo.path))
    const resolved = await runOp(requireGit(repo.path))
    expect(resolved).toBe(created)
  })

  it('removes abandoned amend indexes when a repo session opens', async () => {
    const gitDir = repo.git('rev-parse', '--absolute-git-dir').trim()
    const staleIndex = path.join(gitDir, 'rebase-amend-index-12345')
    const unrelatedFile = path.join(gitDir, 'rebase-amend-state')
    fs.writeFileSync(staleIndex, 'stale')
    fs.writeFileSync(unrelatedFile, 'keep')

    await runOp(openSession(repo.path))

    expect(fs.existsSync(staleIndex)).toBe(false)
    expect(fs.readFileSync(unrelatedFile, 'utf8')).toBe('keep')
  })

  it('exposes the same session state through its Layer-provided service', async () => {
    const created = await runOp(openSession(repo.path))
    const viaService = await runOp(
      Effect.flatMap(RepoSessions, (sessions) => sessions.requireGit(repo.path)).pipe(
        Effect.provide(RepoSessionsLive)
      )
    )
    expect(viaService).toBe(created)
  })
})

describe('RepoSessions session scope', () => {
  it('runs a withSessionScope finalizer when the scoped effect completes', async () => {
    await runOp(openSession(repo.path))
    let released = false
    const probe = Effect.acquireRelease(Effect.succeed('resource'), () =>
      Effect.sync(() => {
        released = true
      })
    )

    await runOp(withSessionScope(repo.path, probe))

    expect(released).toBe(true)
  })

  it('force-runs an in-flight withSessionScope finalizer when the repo closes', async () => {
    await runOp(openSession(repo.path))
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

        const fiber = yield* Effect.fork(withSessionScope(repo.path, probe))
        yield* Deferred.await(acquired)
        yield* closeSession(repo.path)
        expect(released).toBe(true)
        yield* Deferred.succeed(held, undefined)
        yield* Fiber.join(fiber)
      })
    )

    expect(released).toBe(true)
  })
})

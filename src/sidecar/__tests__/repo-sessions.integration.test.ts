import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NotARepo, RepoNotOpen } from '../git-errors'
import { closeRepo, openRepo } from '../operations'
import {
  openSession,
  RepoSessions,
  RepoSessionsLive,
  requireGit,
  requireOpen
} from '../repo-sessions'

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
  await Effect.runPromise(closeRepo(repoDir))
  fs.rmSync(baseDir, { recursive: true, force: true })
})

describe('RepoSessions spine', () => {
  it('yields the open repo simple-git instance through requireGit after openRepo', async () => {
    const response = await Effect.runPromise(openRepo(repoDir))
    expect(response.result.path).toBe(fs.realpathSync.native(repoDir))

    const instance = await Effect.runPromise(requireGit(repoDir))
    const branch = await instance.revparse(['--abbrev-ref', 'HEAD'])
    expect(branch.trim()).toBe('main')
  })

  it('fails NotARepo for a non-repo path and leaves no session behind', async () => {
    const plainDir = path.join(baseDir, 'plain')
    fs.mkdirSync(plainDir)

    const opened = await Effect.runPromise(Effect.either(openRepo(plainDir)))
    expect(opened._tag).toBe('Left')
    expect((opened as { left: unknown }).left).toBeInstanceOf(NotARepo)

    const required = await Effect.runPromise(Effect.either(requireGit(plainDir)))
    expect(required._tag).toBe('Left')
    expect((required as { left: unknown }).left).toBeInstanceOf(RepoNotOpen)
  })

  it('fails requireGit and requireOpen with RepoNotOpen after close', async () => {
    await Effect.runPromise(openRepo(repoDir))
    await Effect.runPromise(closeRepo(repoDir))

    const git = await Effect.runPromise(Effect.either(requireGit(repoDir)))
    expect(git._tag).toBe('Left')
    expect((git as { left: unknown }).left).toBeInstanceOf(RepoNotOpen)

    const open = await Effect.runPromise(Effect.either(requireOpen(repoDir)))
    expect(open._tag).toBe('Left')
    expect((open as { left: unknown }).left).toBeInstanceOf(RepoNotOpen)
  })

  it('creates the session in open so requireGit later resolves the same instance', async () => {
    const created = await Effect.runPromise(openSession(repoDir))
    const resolved = await Effect.runPromise(requireGit(repoDir))
    expect(resolved).toBe(created)
  })

  it('exposes the same session state through its Layer-provided service', async () => {
    const created = await Effect.runPromise(openSession(repoDir))
    const viaService = await Effect.runPromise(
      Effect.flatMap(RepoSessions, (sessions) => sessions.requireGit(repoDir)).pipe(
        Effect.provide(RepoSessionsLive)
      )
    )
    expect(viaService).toBe(created)
  })
})

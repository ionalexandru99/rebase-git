import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Effect } from 'effect'
import type { SimpleGit } from 'simple-git'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { withRepoLock } from '../../session/lock'
import {
  createHangingGit,
  killIfAlive,
  processAlive,
  waitUntil
} from '../../test-support/hanging-git'
import { getOrCreateGit, lookupGit, normalizeRepoPath } from '../instances'

describe('normalizeRepoPath', () => {
  it('strips trailing slashes', () => {
    const inputPath = path.join(path.sep, 'tmp', 'rebase-nonexistent-repo') + path.sep
    const expected = path.resolve(path.sep, 'tmp', 'rebase-nonexistent-repo')
    expect(normalizeRepoPath(inputPath)).toBe(expected)
  })

  it('collapses internal . and .. segments', () => {
    const inputPath = path.join(path.sep, 'tmp', '.', 'rebase-x', '..', 'rebase-x')
    const expected = path.resolve(path.sep, 'tmp', 'rebase-x')
    expect(normalizeRepoPath(inputPath)).toBe(expected)
  })

  it('is idempotent', () => {
    const once = normalizeRepoPath(path.join(path.sep, 'tmp', 'rebase-nonexistent-repo') + path.sep)
    expect(normalizeRepoPath(once)).toBe(once)
  })

  it('resolves an existing directory through realpath (collapses symlinks)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-realpath-'))
    try {
      const linkPath = path.join(os.tmpdir(), `rebase-realpath-link-${process.pid}`)
      try {
        fs.symlinkSync(tmpDir, linkPath, 'dir')
      } catch {
        expect(normalizeRepoPath(tmpDir)).toBe(fs.realpathSync.native(tmpDir))
        return
      }
      try {
        expect(normalizeRepoPath(linkPath)).toBe(normalizeRepoPath(tmpDir))
      } finally {
        fs.unlinkSync(linkPath)
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

describe('getOrCreateGit + lookupGit', () => {
  let tmpDir: string

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-instances-'))
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns the same instance for slash-variant paths', () => {
    const map = new Map<string, SimpleGit>()
    const first = getOrCreateGit(map, tmpDir)
    const second = getOrCreateGit(map, tmpDir + path.sep)
    expect(first).toBe(second)
    expect(map.size).toBe(1)
  })

  it('lookupGit finds an instance under a non-normalized key', () => {
    const map = new Map<string, SimpleGit>()
    const created = getOrCreateGit(map, tmpDir)
    expect(lookupGit(map, tmpDir + path.sep)).toBe(created)
    expect(lookupGit(map, path.join(tmpDir, '.') + path.sep)).toBe(created)
  })

  it('lookupGit returns undefined for repos not in the map', () => {
    const map = new Map<string, SimpleGit>()
    expect(lookupGit(map, tmpDir)).toBeUndefined()
  })

  it('cancels a SimpleGit process on lock timeout before admitting the next owner', async () => {
    const fake = createHangingGit('rebase-simple-git-cancel-')
    // simple-git rejects `--upload-pack` on the command line, so the hang comes from repo config.
    execFileSync('git', ['-C', fake.repoDir, 'remote', 'add', 'hanging', fake.remoteDir], {
      stdio: 'ignore'
    })
    execFileSync(
      'git',
      ['-C', fake.repoDir, 'config', 'remote.hanging.uploadpack', fake.uploadPack],
      {
        stdio: 'ignore'
      }
    )
    const map = new Map<string, SimpleGit>()
    const repoPath = normalizeRepoPath(fake.repoDir)
    const git = getOrCreateGit(map, repoPath)
    let descendantAliveWhenNextOwnerStarted = true

    try {
      const timedOutPromise = Effect.runPromise(
        Effect.either(
          withRepoLock(
            repoPath,
            Effect.promise(() => git.raw(['-C', fake.repoDir, 'fetch', 'hanging'])),
            { timeoutMs: 2_000 }
          )
        )
      )
      await waitUntil(() => fake.childPid() !== undefined, 10_000, 'hanging git child')
      const descendantPid = fake.childPid()
      const nextOwnerPromise = Effect.runPromise(
        withRepoLock(
          repoPath,
          Effect.sync(() => {
            descendantAliveWhenNextOwnerStarted = processAlive(descendantPid)
          })
        )
      )
      const [timedOut] = await Promise.all([timedOutPromise, nextOwnerPromise])

      expect(timedOut._tag).toBe('Left')
      expect(descendantAliveWhenNextOwnerStarted).toBe(false)
      expect(processAlive(descendantPid)).toBe(false)
    } finally {
      killIfAlive(fake.childPid())
      fake.cleanup()
    }
  }, 30_000)
})

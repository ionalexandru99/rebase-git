import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Effect } from 'effect'
import type { SimpleGit } from 'simple-git'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { withRepoLock } from '../../repo-lock'
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
    const fakeBin = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-simple-git-cancel-'))
    )
    const gitPath = path.join(fakeBin, 'git')
    fs.writeFileSync(
      gitPath,
      `#!/bin/sh\nprintf '%s\\n' "$$" >&2\ntrap '/bin/sleep 0.1; exit 0' TERM INT\nwhile true; do /bin/sleep 0.05; done\n`
    )
    fs.chmodSync(gitPath, 0o755)
    const map = new Map<string, SimpleGit>()
    const repoPath = normalizeRepoPath(tmpDir)
    const git = getOrCreateGit(map, repoPath)
    git.env({
      PATH: `${fakeBin}:${process.env.PATH ?? ''}`
    })
    let childPid: number | undefined
    git.outputHandler((_command, _stdout, stderr) => {
      stderr.on('data', (chunk) => {
        childPid = Number(String(chunk).trim())
      })
    })
    let childRunningWhenNextOwnerStarted = true

    try {
      const timedOutPromise = Effect.runPromise(
        Effect.either(
          withRepoLock(
            repoPath,
            Effect.promise(() => git.raw(['status'])),
            { timeoutMs: 3_000 }
          )
        )
      )
      await waitUntil(() => childPid !== undefined)
      const nextOwnerPromise = Effect.runPromise(
        withRepoLock(
          repoPath,
          Effect.sync(() => {
            try {
              process.kill(childPid as number, 0)
            } catch {
              childRunningWhenNextOwnerStarted = false
            }
          })
        )
      )
      const [timedOut] = await Promise.all([timedOutPromise, nextOwnerPromise])

      expect(timedOut._tag).toBe('Left')
      expect(childRunningWhenNextOwnerStarted).toBe(false)
    } finally {
      if (childPid !== undefined) {
        try {
          process.kill(childPid, 'SIGKILL')
        } catch {}
      }
      fs.rmSync(fakeBin, { recursive: true, force: true })
    }
  })
})

async function waitUntil(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('condition timed out')
}

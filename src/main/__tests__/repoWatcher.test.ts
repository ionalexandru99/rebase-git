import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { WebContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ignoreWorkingTree,
  resolveGitDirs,
  startDebouncedDrain,
  startWatching,
  stopWatching
} from '../repoWatcher'

describe('ignoreWorkingTree', () => {
  it('ignores the .git directory', () => {
    expect(ignoreWorkingTree('/repo/.git/HEAD')).toBe(true)
  })

  it('ignores common build-output dirs at any depth', () => {
    expect(ignoreWorkingTree('/repo/node_modules/foo/index.js')).toBe(true)
    expect(ignoreWorkingTree('/repo/target/debug/main')).toBe(true)
    expect(ignoreWorkingTree('/repo/packages/app/dist/bundle.js')).toBe(true)
    expect(ignoreWorkingTree('/repo/out/main/index.js')).toBe(true)
    expect(ignoreWorkingTree('/repo/.next/cache/foo')).toBe(true)
    expect(ignoreWorkingTree('/repo/.turbo/run.log')).toBe(true)
    expect(ignoreWorkingTree('/repo/coverage/lcov-report/index.html')).toBe(true)
    expect(ignoreWorkingTree('/repo/playwright-report/index.html')).toBe(true)
    expect(ignoreWorkingTree('/repo/test-results/results.xml')).toBe(true)
  })

  it('does not ignore source files', () => {
    expect(ignoreWorkingTree('/repo/src/main.ts')).toBe(false)
    expect(ignoreWorkingTree('/repo/README.md')).toBe(false)
    expect(ignoreWorkingTree('/repo/package.json')).toBe(false)
  })

  it('does not ignore files whose name merely contains an ignored token', () => {
    expect(ignoreWorkingTree('/repo/src/build-config.ts')).toBe(false)
    expect(ignoreWorkingTree('/repo/dist-info.md')).toBe(false)
  })

  it('handles Windows-style separators', () => {
    expect(ignoreWorkingTree('C:\\repo\\node_modules\\foo')).toBe(true)
    expect(ignoreWorkingTree('C:\\repo\\src\\main.ts')).toBe(false)
  })

  it('matches case-insensitively for case-insensitive filesystems', () => {
    expect(ignoreWorkingTree('/repo/Node_Modules/foo')).toBe(true)
    expect(ignoreWorkingTree('/repo/NODE_MODULES/foo')).toBe(true)
    expect(ignoreWorkingTree('/repo/.GIT/HEAD')).toBe(true)
    expect(ignoreWorkingTree('/repo/Target/release/bin')).toBe(true)
  })
})

describe('startDebouncedDrain', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('fires once after events go idle', () => {
    const onFire = vi.fn()
    const drain = startDebouncedDrain(30, onFire)

    drain.push()
    drain.push()
    drain.push()

    expect(onFire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(80)
    expect(onFire).toHaveBeenCalledTimes(1)

    drain.stop()
  })

  it('fires again after another idle period', () => {
    const onFire = vi.fn()
    const drain = startDebouncedDrain(30, onFire)

    drain.push()
    vi.advanceTimersByTime(80)
    expect(onFire).toHaveBeenCalledTimes(1)

    drain.push()
    vi.advanceTimersByTime(80)
    expect(onFire).toHaveBeenCalledTimes(2)

    drain.stop()
  })

  it('stops firing after stop is called', () => {
    const onFire = vi.fn()
    const drain = startDebouncedDrain(30, onFire)

    drain.stop()
    drain.push()
    vi.advanceTimersByTime(80)

    expect(onFire).not.toHaveBeenCalled()
  })
})

describe('startWatching working-tree detection', () => {
  let repoDir: string
  const events: Array<{ repoPath: string; kind: string }> = []

  const fakeWebContents = {
    id: 1,
    isDestroyed: () => false,
    send: (channel: string, payload: { repoPath: string; kind: string }) => {
      if (channel === 'repo-changed') {
        events.push(payload)
      }
    },
    once: () => {},
    removeListener: () => {}
  } as unknown as WebContents

  const waitFor = async (predicate: () => boolean, timeoutMs = 4000) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (predicate()) {
        return true
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return predicate()
  }

  beforeEach(() => {
    events.length = 0
    repoDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-watch-test-')))
    fs.mkdirSync(path.join(repoDir, '.git', 'refs'), { recursive: true })
    fs.writeFileSync(path.join(repoDir, '.git', 'HEAD'), 'ref: refs/heads/main\n')
    fs.mkdirSync(path.join(repoDir, 'src'))
  })

  afterEach(async () => {
    await stopWatching(repoDir, fakeWebContents.id)
    fs.rmSync(repoDir, { recursive: true, force: true })
  })

  it('emits a workingTree change when a nested file is edited', async () => {
    await startWatching(repoDir, fakeWebContents)
    // give chokidar time to finish its initial scan before mutating
    await new Promise((resolve) => setTimeout(resolve, 400))

    fs.writeFileSync(path.join(repoDir, 'src', 'nested.ts'), 'export const x = 1\n')

    const seen = await waitFor(() => events.some((event) => event.kind === 'workingTree'))
    expect(seen).toBe(true)
  })
})

function initRepo(dir: string): void {
  execFileSync('git', ['-C', dir, 'init', '-b', 'main'])
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@example.com'])
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Test'])
  fs.writeFileSync(path.join(dir, 'README.md'), '# test\n')
  execFileSync('git', ['-C', dir, 'add', 'README.md'])
  execFileSync('git', ['-C', dir, 'commit', '-m', 'initial'])
}

function makeFakeWebContents(
  id: number,
  events: Array<{ repoPath: string; kind: string }>
): WebContents {
  return {
    id,
    isDestroyed: () => false,
    send: (channel: string, payload: { repoPath: string; kind: string }) => {
      if (channel === 'repo-changed') {
        events.push(payload)
      }
    },
    once: () => {},
    removeListener: () => {}
  } as unknown as WebContents
}

const waitFor = async (predicate: () => boolean, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return predicate()
}

describe('resolveGitDirs', () => {
  let repoDir: string

  beforeEach(() => {
    repoDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-resolve-test-')))
    initRepo(repoDir)
  })

  afterEach(() => {
    fs.rmSync(repoDir, { recursive: true, force: true })
  })

  it('resolves a normal repo to its own .git directory', async () => {
    const { gitDir, commonDir } = await resolveGitDirs(repoDir)
    expect(path.isAbsolute(gitDir)).toBe(true)
    expect(path.isAbsolute(commonDir)).toBe(true)
    expect(fs.realpathSync.native(gitDir)).toBe(fs.realpathSync.native(path.join(repoDir, '.git')))
    expect(fs.realpathSync.native(commonDir)).toBe(
      fs.realpathSync.native(path.join(repoDir, '.git'))
    )
  })

  it('resolves a linked worktree to a distinct gitdir and a shared common dir', async () => {
    const worktreeDir = `${repoDir}-wt`
    execFileSync('git', ['-C', repoDir, 'worktree', 'add', worktreeDir, '-b', 'feature'])
    try {
      const { gitDir, commonDir } = await resolveGitDirs(worktreeDir)
      expect(path.isAbsolute(gitDir)).toBe(true)
      expect(path.isAbsolute(commonDir)).toBe(true)
      // For a worktree, .git is a file pointing into the main repo's .git/worktrees/<name>.
      expect(fs.realpathSync.native(gitDir)).not.toBe(fs.realpathSync.native(worktreeDir))
      expect(fs.realpathSync.native(commonDir)).toBe(
        fs.realpathSync.native(path.join(repoDir, '.git'))
      )
    } finally {
      fs.rmSync(worktreeDir, { recursive: true, force: true })
    }
  })
})

describe('startWatching index detection', () => {
  let repoDir: string
  const events: Array<{ repoPath: string; kind: string }> = []
  const fakeWebContents = makeFakeWebContents(2, events)

  beforeEach(() => {
    events.length = 0
    repoDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-index-test-')))
    initRepo(repoDir)
  })

  afterEach(async () => {
    await stopWatching(repoDir, fakeWebContents.id)
    fs.rmSync(repoDir, { recursive: true, force: true })
  })

  it('emits an index change when a file is staged via the git CLI', async () => {
    await startWatching(repoDir, fakeWebContents)
    await new Promise((resolve) => setTimeout(resolve, 400))

    fs.writeFileSync(path.join(repoDir, 'staged.ts'), 'export const staged = 1\n')
    execFileSync('git', ['-C', repoDir, 'add', 'staged.ts'])

    const seen = await waitFor(() => events.some((event) => event.kind === 'index'))
    expect(seen).toBe(true)
  })
})

describe('startWatching linked-worktree refs detection', () => {
  let repoDir: string
  let worktreeDir: string
  const events: Array<{ repoPath: string; kind: string }> = []
  const fakeWebContents = makeFakeWebContents(3, events)

  beforeEach(() => {
    events.length = 0
    repoDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-wt-test-')))
    initRepo(repoDir)
    worktreeDir = `${repoDir}-wt`
    execFileSync('git', ['-C', repoDir, 'worktree', 'add', worktreeDir, '-b', 'feature'])
  })

  afterEach(async () => {
    await stopWatching(worktreeDir, fakeWebContents.id)
    fs.rmSync(worktreeDir, { recursive: true, force: true })
    fs.rmSync(repoDir, { recursive: true, force: true })
  })

  it('emits a refs change when a commit moves HEAD in the worktree', async () => {
    await startWatching(worktreeDir, fakeWebContents)
    await new Promise((resolve) => setTimeout(resolve, 400))

    fs.writeFileSync(path.join(worktreeDir, 'feature.ts'), 'export const feature = 1\n')
    execFileSync('git', ['-C', worktreeDir, 'add', 'feature.ts'])
    execFileSync('git', ['-C', worktreeDir, 'commit', '-m', 'feature commit'])

    const seen = await waitFor(() => events.some((event) => event.kind === 'refs'))
    expect(seen).toBe(true)
  })
})

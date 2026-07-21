import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { WebContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ignoreWorkingTree,
  shouldEmitWorkingTreeChange,
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

describe('shouldEmitWorkingTreeChange', () => {
  it('does not echo git-internal watcher events as working-tree changes', () => {
    expect(shouldEmitWorkingTreeChange('.git/index')).toBe(false)
    expect(shouldEmitWorkingTreeChange('.git/refs/heads/main')).toBe(false)
  })

  it('ignores native watcher events without a filename', () => {
    expect(shouldEmitWorkingTreeChange(null)).toBe(false)
  })

  it('emits source file changes', () => {
    expect(shouldEmitWorkingTreeChange('src/main.ts')).toBe(true)
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
    startWatching(repoDir, fakeWebContents)
    // give the watcher time to finish its initial scan before mutating
    await new Promise((resolve) => setTimeout(resolve, 400))

    fs.writeFileSync(path.join(repoDir, 'src', 'nested.ts'), 'export const x = 1\n')

    const seen = await waitFor(() => events.some((event) => event.kind === 'workingTree'))
    expect(seen).toBe(true)
  })

  it('detects edits inside directories created after the watch starts', async () => {
    startWatching(repoDir, fakeWebContents)
    await new Promise((resolve) => setTimeout(resolve, 400))

    const deepDir = path.join(repoDir, 'src', 'feature', 'deep')
    fs.mkdirSync(deepDir, { recursive: true })
    fs.writeFileSync(path.join(deepDir, 'new.ts'), 'export const y = 2\n')

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

function resolveGitDirsViaCli(repoPath: string): { gitDir: string; commonDir: string } {
  const output = execFileSync(
    'git',
    ['-C', repoPath, 'rev-parse', '--git-dir', '--git-common-dir'],
    { encoding: 'utf8' }
  )
  const lines = output.split('\n').filter((line) => line.trim().length > 0)
  return {
    gitDir: path.resolve(repoPath, lines[0].trim()),
    commonDir: path.resolve(repoPath, lines[1].trim())
  }
}

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
    startWatching(repoDir, fakeWebContents)
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
    startWatching(worktreeDir, fakeWebContents, resolveGitDirsViaCli(worktreeDir))
    await new Promise((resolve) => setTimeout(resolve, 400))

    fs.writeFileSync(path.join(worktreeDir, 'feature.ts'), 'export const feature = 1\n')
    execFileSync('git', ['-C', worktreeDir, 'add', 'feature.ts'])
    execFileSync('git', ['-C', worktreeDir, 'commit', '-m', 'feature commit'])

    const seen = await waitFor(() => events.some((event) => event.kind === 'refs'))
    expect(seen).toBe(true)
  })
})

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { WebContents } from 'electron'
import { describe, expect, it } from 'vitest'
import { startWatching, stopWatching } from '../watcher'

interface RepoChange {
  repoPath: string
  kind: string
}

function initRepo(dir: string): void {
  execFileSync('git', ['-C', dir, 'init', '-b', 'main'])
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@example.com'])
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Test'])
  fs.writeFileSync(path.join(dir, 'README.md'), '# test\n')
  execFileSync('git', ['-C', dir, 'add', 'README.md'])
  execFileSync('git', ['-C', dir, 'commit', '-m', 'initial'])
}

function startConflictedCherryPick(dir: string): void {
  const run = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' })
  fs.writeFileSync(path.join(dir, 'f.txt'), 'base\n')
  run('add', 'f.txt')
  run('commit', '-m', 'base')
  run('checkout', '-b', 'feature')
  fs.writeFileSync(path.join(dir, 'f.txt'), 'feature\n')
  run('commit', '-am', 'feature work')
  run('checkout', 'main')
  fs.writeFileSync(path.join(dir, 'f.txt'), 'main\n')
  run('commit', '-am', 'main work')
  try {
    run('cherry-pick', 'feature')
  } catch {}
}

function makeFakeWebContents(id: number, events: RepoChange[]): WebContents {
  return {
    id,
    isDestroyed: () => false,
    send: (channel: string, payload: RepoChange) => {
      if (channel === 'repo-changed') {
        events.push(payload)
      }
    },
    once: () => {},
    removeListener: () => {}
  } as unknown as WebContents
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return predicate()
}

async function waitForEvent(
  events: RepoChange[],
  kind: string,
  mutate: (attempt: number) => void
): Promise<boolean> {
  for (let attempt = 0; attempt < 5; attempt++) {
    mutate(attempt)
    if (await waitFor(() => events.some((event) => event.kind === kind), 2000)) {
      return true
    }
  }
  return false
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

describe('repo watcher integration', () => {
  it('emits working-tree changes for nested edits and newly created directories', async () => {
    const events: RepoChange[] = []
    const fakeWebContents = makeFakeWebContents(1, events)
    const repoDir = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-watch-test-'))
    )
    fs.mkdirSync(path.join(repoDir, '.git', 'refs'), { recursive: true })
    fs.writeFileSync(path.join(repoDir, '.git', 'HEAD'), 'ref: refs/heads/main\n')
    fs.mkdirSync(path.join(repoDir, 'src'))

    try {
      await startWatching(repoDir, fakeWebContents)
      const nestedSeen = await waitForEvent(events, 'workingTree', (attempt) => {
        fs.writeFileSync(path.join(repoDir, 'src', `nested-${attempt}.ts`), 'export const x = 1\n')
      })
      expect(nestedSeen).toBe(true)

      events.length = 0
      const newDirectorySeen = await waitForEvent(events, 'workingTree', (attempt) => {
        const deepDir = path.join(repoDir, 'src', `feature-${attempt}`, 'deep')
        fs.mkdirSync(deepDir, { recursive: true })
        fs.writeFileSync(path.join(deepDir, 'new.ts'), 'export const y = 2\n')
      })
      expect(newDirectorySeen).toBe(true)
    } finally {
      await stopWatching(repoDir, fakeWebContents.id)
      fs.rmSync(repoDir, { recursive: true, force: true })
    }
  })

  it('emits an index change when a file is staged via Git', async () => {
    const events: RepoChange[] = []
    const fakeWebContents = makeFakeWebContents(2, events)
    const repoDir = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-index-test-'))
    )
    initRepo(repoDir)

    try {
      await startWatching(repoDir, fakeWebContents)
      const seen = await waitForEvent(events, 'index', (attempt) => {
        const name = `staged-${attempt}.ts`
        fs.writeFileSync(path.join(repoDir, name), 'export const staged = 1\n')
        execFileSync('git', ['-C', repoDir, 'add', name])
      })
      expect(seen).toBe(true)
    } finally {
      await stopWatching(repoDir, fakeWebContents.id)
      fs.rmSync(repoDir, { recursive: true, force: true })
    }
  })

  it('emits an index change when a cherry-pick is quit from outside the app', async () => {
    const events: RepoChange[] = []
    const fakeWebContents = makeFakeWebContents(4, events)
    const repoDir = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-op-state-test-'))
    )
    initRepo(repoDir)
    startConflictedCherryPick(repoDir)
    expect(fs.existsSync(path.join(repoDir, '.git', 'CHERRY_PICK_HEAD'))).toBe(true)
    const indexModifiedBefore = fs.statSync(path.join(repoDir, '.git', 'index')).mtimeMs

    try {
      await startWatching(repoDir, fakeWebContents)
      events.length = 0
      execFileSync('git', ['-C', repoDir, 'cherry-pick', '--quit'])

      const seen = await waitFor(() => events.some((event) => event.kind === 'index'), 3000)
      expect(seen).toBe(true)
      expect(fs.existsSync(path.join(repoDir, '.git', 'CHERRY_PICK_HEAD'))).toBe(false)
      expect(fs.statSync(path.join(repoDir, '.git', 'index')).mtimeMs).toBe(indexModifiedBefore)
    } finally {
      await stopWatching(repoDir, fakeWebContents.id)
      fs.rmSync(repoDir, { recursive: true, force: true })
    }
  })

  it('emits a refs change when a linked-worktree HEAD moves', async () => {
    const events: RepoChange[] = []
    const fakeWebContents = makeFakeWebContents(3, events)
    const repoDir = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-wt-test-'))
    )
    initRepo(repoDir)
    const worktreeDir = `${repoDir}-wt`
    execFileSync('git', ['-C', repoDir, 'worktree', 'add', worktreeDir, '-b', 'feature'])

    try {
      await startWatching(worktreeDir, fakeWebContents, resolveGitDirsViaCli(worktreeDir))
      const seen = await waitForEvent(events, 'refs', (attempt) => {
        const name = `feature-${attempt}.ts`
        fs.writeFileSync(path.join(worktreeDir, name), 'export const feature = 1\n')
        execFileSync('git', ['-C', worktreeDir, 'add', name])
        execFileSync('git', ['-C', worktreeDir, 'commit', '-m', `feature commit ${attempt}`])
      })
      expect(seen).toBe(true)
    } finally {
      await stopWatching(worktreeDir, fakeWebContents.id)
      fs.rmSync(worktreeDir, { recursive: true, force: true })
      fs.rmSync(repoDir, { recursive: true, force: true })
    }
  })
})

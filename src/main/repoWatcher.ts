import path from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import { Effect, Fiber, Queue, Stream } from 'effect'
import type { WebContents } from 'electron'

export type RepoChangeKind = 'refs' | 'workingTree'

interface Watcher {
  refs: FSWatcher
  workingTree: FSWatcher
  refsQueue: Queue.Queue<void>
  workingTreeQueue: Queue.Queue<void>
  refsFiber: Fiber.RuntimeFiber<void, never>
  workingTreeFiber: Fiber.RuntimeFiber<void, never>
  webContents: WebContents
  onDestroyed: () => void
}

const watchers = new Map<string, Watcher>()
const DEBOUNCE_MS = 300

export const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'target',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  '.parcel-cache',
  '.gradle',
  'coverage',
  '.nyc_output',
  'playwright-report',
  'test-results',
  '__pycache__'
])

export function ignoreWorkingTree(targetPath: string): boolean {
  const segments = targetPath.split(/[/\\]/)
  for (const segment of segments) {
    if (IGNORED_DIRS.has(segment.toLowerCase())) return true
  }
  return false
}

export function startDebouncedDrain(
  queue: Queue.Queue<void>,
  delayMs: number,
  onFire: () => void
): Fiber.RuntimeFiber<void, never> {
  return Effect.runFork(
    Stream.fromQueue(queue).pipe(
      Stream.debounce(delayMs),
      Stream.runForEach(() => Effect.sync(onFire)),
      Effect.catchAllCause(() => Effect.void)
    )
  )
}

export function startWatching(repoPath: string, webContents: WebContents): void {
  const existing = watchers.get(repoPath)
  if (existing) {
    if (existing.webContents === webContents && !webContents.isDestroyed()) return
    void stopWatching(repoPath)
  }

  const gitDir = path.join(repoPath, '.git')
  const refsTargets = [
    path.join(gitDir, 'HEAD'),
    path.join(gitDir, 'refs'),
    path.join(gitDir, 'packed-refs')
  ]

  const refsQueue = Effect.runSync(Queue.unbounded<void>())
  const workingTreeQueue = Effect.runSync(Queue.unbounded<void>())

  const emit = (kind: RepoChangeKind) => {
    if (webContents.isDestroyed()) return
    webContents.send('repo-changed', { repoPath, kind })
  }

  const refs = chokidar.watch(refsTargets, {
    ignoreInitial: true,
    persistent: true
  })
  refs.on('all', () => {
    Effect.runSync(Queue.offer(refsQueue, undefined))
  })
  refs.on('error', (err) => console.warn('[repoWatcher] refs error', err))

  const workingTree = chokidar.watch(repoPath, {
    ignored: ignoreWorkingTree,
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 }
  })
  workingTree.on('all', () => {
    Effect.runSync(Queue.offer(workingTreeQueue, undefined))
  })
  workingTree.on('error', (err) => console.warn('[repoWatcher] workingTree error', err))

  const refsFiber = startDebouncedDrain(refsQueue, DEBOUNCE_MS, () => emit('refs'))
  const workingTreeFiber = startDebouncedDrain(workingTreeQueue, DEBOUNCE_MS, () =>
    emit('workingTree')
  )

  const onDestroyed = () => {
    void stopWatching(repoPath)
  }
  webContents.once('destroyed', onDestroyed)

  watchers.set(repoPath, {
    refs,
    workingTree,
    refsQueue,
    workingTreeQueue,
    refsFiber,
    workingTreeFiber,
    webContents,
    onDestroyed
  })
}

export async function stopWatching(repoPath: string): Promise<void> {
  const w = watchers.get(repoPath)
  if (!w) return
  watchers.delete(repoPath)
  w.webContents.removeListener('destroyed', w.onDestroyed)
  await Effect.runPromise(
    Effect.all(
      [
        Fiber.interrupt(w.refsFiber),
        Fiber.interrupt(w.workingTreeFiber),
        Queue.shutdown(w.refsQueue),
        Queue.shutdown(w.workingTreeQueue)
      ],
      { discard: true }
    )
  )
  try {
    await Promise.all([w.refs.close(), w.workingTree.close()])
  } catch (err) {
    console.warn('[repoWatcher] close error', err)
  }
}

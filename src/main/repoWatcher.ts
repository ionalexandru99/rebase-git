import path from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import type { WebContents } from 'electron'

export type RepoChangeKind = 'refs' | 'workingTree'

export interface Debouncer<K extends string> {
  schedule(key: K, fn: () => void): void
  cancelAll(): void
}

export function createDebouncer<K extends string>(delayMs: number): Debouncer<K> {
  const timers = new Map<K, NodeJS.Timeout>()
  return {
    schedule(key, fn) {
      const existing = timers.get(key)
      if (existing) clearTimeout(existing)
      const handle = setTimeout(() => {
        timers.delete(key)
        fn()
      }, delayMs)
      timers.set(key, handle)
    },
    cancelAll() {
      for (const handle of timers.values()) clearTimeout(handle)
      timers.clear()
    }
  }
}

interface Watcher {
  refs: FSWatcher
  workingTree: FSWatcher
  debouncer: Debouncer<RepoChangeKind>
  webContents: WebContents
  onDestroyed: () => void
}

const watchers = new Map<string, Watcher>()
const DEBOUNCE_MS = 300

// Conservative deny-list of directories that are almost universally generated
// or vendor-owned, so chokidar doesn't pump events for build artefacts. A
// proper gitignore-aware predicate (driven by `git ls-files`) is tracked
// separately; this is enough to keep the watcher quiet for the common cases
// (Node, Rust, Java, Next.js, Turbo, Gradle, test reports, etc.).
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

// Names are matched case-insensitively so we cover case-insensitive filesystems
// (default macOS, Windows) where 'Node_Modules' and 'node_modules' resolve to
// the same directory but would otherwise miss the deny-list.
export function ignoreWorkingTree(targetPath: string): boolean {
  const segments = targetPath.split(/[/\\]/)
  for (const segment of segments) {
    if (IGNORED_DIRS.has(segment.toLowerCase())) return true
  }
  return false
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

  const debouncer = createDebouncer<RepoChangeKind>(DEBOUNCE_MS)

  const emit = (kind: RepoChangeKind) => {
    if (webContents.isDestroyed()) return
    webContents.send('repo-changed', { repoPath, kind })
  }

  const refs = chokidar.watch(refsTargets, {
    ignoreInitial: true,
    persistent: true
  })
  refs.on('all', () => debouncer.schedule('refs', () => emit('refs')))
  refs.on('error', (err) => console.warn('[repoWatcher] refs error', err))

  const workingTree = chokidar.watch(repoPath, {
    ignored: ignoreWorkingTree,
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 }
  })
  workingTree.on('all', () => debouncer.schedule('workingTree', () => emit('workingTree')))
  workingTree.on('error', (err) => console.warn('[repoWatcher] workingTree error', err))

  const onDestroyed = () => {
    void stopWatching(repoPath)
  }
  webContents.once('destroyed', onDestroyed)

  watchers.set(repoPath, { refs, workingTree, debouncer, webContents, onDestroyed })
}

export async function stopWatching(repoPath: string): Promise<void> {
  const w = watchers.get(repoPath)
  if (!w) return
  watchers.delete(repoPath)
  w.webContents.removeListener('destroyed', w.onDestroyed)
  w.debouncer.cancelAll()
  try {
    await Promise.all([w.refs.close(), w.workingTree.close()])
  } catch (err) {
    console.warn('[repoWatcher] close error', err)
  }
}

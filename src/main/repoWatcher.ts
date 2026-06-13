import path from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import type { WebContents } from 'electron'
import { type DebouncedDrain, startDebouncedDrain } from './debounced-drain'

export type RepoChangeKind = 'refs' | 'workingTree'

interface Watcher {
  refs: FSWatcher
  workingTree: FSWatcher
  refsDrain: DebouncedDrain
  workingTreeDrain: DebouncedDrain
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
    if (IGNORED_DIRS.has(segment.toLowerCase())) {
      return true
    }
  }
  return false
}

export { startDebouncedDrain } from './debounced-drain'

export function startWatching(repoPath: string, webContents: WebContents): void {
  const existing = watchers.get(repoPath)
  if (existing) {
    if (existing.webContents === webContents && !webContents.isDestroyed()) {
      return
    }
    void stopWatching(repoPath)
  }

  const gitDir = path.join(repoPath, '.git')
  const refsTargets = [
    path.join(gitDir, 'HEAD'),
    path.join(gitDir, 'refs'),
    path.join(gitDir, 'packed-refs')
  ]

  const emit = (kind: RepoChangeKind) => {
    if (webContents.isDestroyed()) {
      return
    }
    webContents.send('repo-changed', { repoPath, kind })
  }

  const refsDrain = startDebouncedDrain(DEBOUNCE_MS, () => emit('refs'))
  const workingTreeDrain = startDebouncedDrain(DEBOUNCE_MS, () => emit('workingTree'))

  const refs = chokidar.watch(refsTargets, {
    ignoreInitial: true,
    persistent: true
  })
  refs.on('all', () => refsDrain.push())
  refs.on('error', (err) => console.warn('[repoWatcher] refs error', err))

  // Watch the whole working tree (chokidar 4 uses native recursive fs.watch, so this no longer
  // costs one descriptor per directory). `ignoreWorkingTree` prunes .git and heavy build dirs so
  // edits to nested source files are detected without drowning in node_modules churn.
  const workingTree = chokidar.watch(repoPath, {
    ignored: ignoreWorkingTree,
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 }
  })
  workingTree.on('all', () => workingTreeDrain.push())
  workingTree.on('error', (err) => console.warn('[repoWatcher] workingTree error', err))

  const onDestroyed = () => {
    void stopWatching(repoPath)
  }
  webContents.once('destroyed', onDestroyed)

  watchers.set(repoPath, {
    refs,
    workingTree,
    refsDrain,
    workingTreeDrain,
    webContents,
    onDestroyed
  })
}

export async function stopWatching(repoPath: string): Promise<void> {
  const watcher = watchers.get(repoPath)
  if (!watcher) {
    return
  }
  watchers.delete(repoPath)
  watcher.webContents.removeListener('destroyed', watcher.onDestroyed)
  watcher.refsDrain.stop()
  watcher.workingTreeDrain.stop()
  try {
    await Promise.all([watcher.refs.close(), watcher.workingTree.close()])
  } catch (err) {
    console.warn('[repoWatcher] close error', err)
  }
}

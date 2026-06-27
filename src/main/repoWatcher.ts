import path from 'node:path'
import { Channel } from '@shared/channels'
import { parseOrThrow } from '@shared/codec'
import { tabResourceKey } from '@shared/repo-path'
import { RepoChangedEventSchema, type RepoChangeKind } from '@shared/schemas/git'
import chokidar, { type FSWatcher } from 'chokidar'
import type { WebContents } from 'electron'
import { type DebouncedDrain, startDebouncedDrain } from './debounced-drain'

interface Watcher {
  refs: FSWatcher
  index: FSWatcher
  workingTree: FSWatcher
  refsDrain: DebouncedDrain
  indexDrain: DebouncedDrain
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

export interface GitDirs {
  gitDir?: string
  commonDir?: string
}

// gitDir/commonDir come resolved from the sidecar's open response (git logic stays out of main);
// they differ from `<repo>/.git` for linked worktrees and submodules. Fall back to the plain
// layout when absent.
export function startWatching(repoPath: string, webContents: WebContents, dirs?: GitDirs): void {
  const key = tabResourceKey(webContents.id, repoPath)
  const existing = watchers.get(key)
  if (existing) {
    if (existing.webContents === webContents && !webContents.isDestroyed()) {
      return
    }
    void stopWatching(repoPath, webContents.id)
  }

  const gitDir = dirs?.gitDir ?? path.join(repoPath, '.git')
  const commonDir = dirs?.commonDir ?? gitDir
  const refsTargets = [
    path.join(gitDir, 'HEAD'),
    path.join(commonDir, 'refs'),
    path.join(commonDir, 'packed-refs')
  ]
  const indexTarget = path.join(gitDir, 'index')

  const emit = (kind: RepoChangeKind) => {
    if (webContents.isDestroyed()) {
      return
    }
    webContents.send(Channel.repoChanged, parseOrThrow(RepoChangedEventSchema, { repoPath, kind }))
  }

  const refsDrain = startDebouncedDrain(DEBOUNCE_MS, () => emit('refs'))
  const indexDrain = startDebouncedDrain(DEBOUNCE_MS, () => emit('index'))
  const workingTreeDrain = startDebouncedDrain(DEBOUNCE_MS, () => emit('workingTree'))

  const refs = chokidar.watch(refsTargets, {
    ignoreInitial: true,
    persistent: true
  })
  refs.on('all', () => refsDrain.push())
  refs.on('error', (err) => console.warn('[repoWatcher] refs error', err))

  const index = chokidar.watch(indexTarget, {
    ignoreInitial: true,
    persistent: true
  })
  index.on('all', () => indexDrain.push())
  index.on('error', (err) => console.warn('[repoWatcher] index error', err))

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
    void stopWatching(repoPath, webContents.id)
  }
  webContents.once('destroyed', onDestroyed)

  watchers.set(key, {
    refs,
    index,
    workingTree,
    refsDrain,
    indexDrain,
    workingTreeDrain,
    webContents,
    onDestroyed
  })
}

export async function stopWatching(repoPath: string, webContentsId: number): Promise<void> {
  const key = tabResourceKey(webContentsId, repoPath)
  const watcher = watchers.get(key)
  if (!watcher) {
    return
  }
  watchers.delete(key)
  watcher.webContents.removeListener('destroyed', watcher.onDestroyed)
  watcher.refsDrain.stop()
  watcher.indexDrain.stop()
  watcher.workingTreeDrain.stop()
  try {
    await Promise.all([watcher.refs.close(), watcher.index.close(), watcher.workingTree.close()])
  } catch (err) {
    console.warn('[repoWatcher] close error', err)
  }
}

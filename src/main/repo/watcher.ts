import fs from 'node:fs'
import path from 'node:path'
import { Channel } from '@shared/channels'
import { parseOrThrow } from '@shared/codec'
import { tabResourceKey } from '@shared/repo-path'
import { RepoChangedEventSchema, type RepoChangeKind } from '@shared/schemas/git'
import chokidar, { type FSWatcher } from 'chokidar'
import type { WebContents } from 'electron'
import { type DebouncedDrain, startDebouncedDrain } from './debounced-drain'

interface CloseableWatch {
  close: () => Promise<void> | void
  ready: Promise<void>
}

interface Watcher {
  refs: FSWatcher
  index: FSWatcher
  operationState: CloseableWatch
  workingTree: CloseableWatch
  ready: Promise<void>
  refsDrain: DebouncedDrain
  indexDrain: DebouncedDrain
  workingTreeDrain: DebouncedDrain
  webContents: WebContents
  onDestroyed: () => void
}

const SUPPORTS_RECURSIVE_FS_WATCH = process.platform === 'darwin' || process.platform === 'win32'

function startWorkingTreeWatch(repoPath: string, onChange: () => void): CloseableWatch {
  if (SUPPORTS_RECURSIVE_FS_WATCH) {
    const watcher = fs.watch(
      repoPath,
      { recursive: true, persistent: true },
      (_event, filename) => {
        if (!shouldEmitWorkingTreeChange(filename)) {
          return
        }
        onChange()
      }
    )
    watcher.on('error', (err) => console.warn('[repoWatcher] workingTree error', err))
    return { close: () => watcher.close(), ready: Promise.resolve() }
  }

  const watcher = chokidar.watch(repoPath, {
    ignored: ignoreWorkingTree,
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 }
  })
  const ready = new Promise<void>((resolve) => watcher.once('ready', resolve))
  watcher.on('all', () => onChange())
  watcher.on('error', (err) => console.warn('[repoWatcher] workingTree error', err))
  return { close: () => watcher.close(), ready }
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

export function shouldEmitWorkingTreeChange(filename: string | Buffer | null): boolean {
  return filename !== null && !ignoreWorkingTree(filename.toString())
}

const OPERATION_STATE_ENTRIES = new Set([
  'MERGE_HEAD',
  'CHERRY_PICK_HEAD',
  'REVERT_HEAD',
  'rebase-merge',
  'rebase-apply',
  'sequencer'
])

export function isOperationStateEntry(filename: string | Buffer | null): boolean {
  if (filename === null) {
    return false
  }
  return OPERATION_STATE_ENTRIES.has(path.basename(filename.toString()))
}

function startOperationStateWatch(gitDir: string, onChange: () => void): CloseableWatch {
  try {
    const watcher = fs.watch(gitDir, { persistent: true }, (_event, filename) => {
      if (!isOperationStateEntry(filename)) {
        return
      }
      onChange()
    })
    watcher.on('error', (err) => console.warn('[repoWatcher] operationState error', err))
    return { close: () => watcher.close(), ready: Promise.resolve() }
  } catch (err) {
    console.warn('[repoWatcher] operationState watch unavailable', err)
    return { close: () => {}, ready: Promise.resolve() }
  }
}

export { startDebouncedDrain } from './debounced-drain'

export interface GitDirs {
  gitDir?: string
  commonDir?: string
}

export function startWatching(
  repoPath: string,
  webContents: WebContents,
  dirs?: GitDirs
): Promise<void> {
  const key = tabResourceKey(webContents.id, repoPath)
  const existing = watchers.get(key)
  if (existing) {
    if (existing.webContents === webContents && !webContents.isDestroyed()) {
      return existing.ready
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
  const refsReady = new Promise<void>((resolve) => refs.once('ready', resolve))
  refs.on('all', () => refsDrain.push())
  refs.on('error', (err) => console.warn('[repoWatcher] refs error', err))

  const index = chokidar.watch(indexTarget, {
    ignoreInitial: true,
    persistent: true
  })
  const indexReady = new Promise<void>((resolve) => index.once('ready', resolve))
  index.on('all', () => indexDrain.push())
  index.on('error', (err) => console.warn('[repoWatcher] index error', err))

  const operationState = startOperationStateWatch(gitDir, () => indexDrain.push())

  const workingTree = startWorkingTreeWatch(repoPath, () => workingTreeDrain.push())

  const onDestroyed = () => {
    void stopWatching(repoPath, webContents.id)
  }
  webContents.once('destroyed', onDestroyed)
  const ready = Promise.all([refsReady, indexReady, operationState.ready, workingTree.ready]).then(
    () => undefined
  )

  watchers.set(key, {
    refs,
    index,
    operationState,
    workingTree,
    ready,
    refsDrain,
    indexDrain,
    workingTreeDrain,
    webContents,
    onDestroyed
  })

  return ready
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
    await Promise.all([
      watcher.refs.close(),
      watcher.index.close(),
      watcher.operationState.close(),
      watcher.workingTree.close()
    ])
  } catch (err) {
    console.warn('[repoWatcher] close error', err)
  }
}

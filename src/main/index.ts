import { type ChildProcess, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import windowStateKeeperModule from 'electron-window-state'
import { simpleGit } from 'simple-git'

const windowStateKeeper = windowStateKeeperModule.default || windowStateKeeperModule

import { tryReserveFetch } from './autoFetch'
import { getOrCreateGit, lookupGit, normalizeRepoPath } from './git/instances'
import { setupContextMenu } from './menu'
import { startWatching, stopWatching } from './repoWatcher'
import {
  addRecentRepo,
  addWorkspace,
  getActiveWorkspace,
  getRecentRepos,
  getWorkingDirectory,
  getWorkspaces,
  isOnboardingComplete,
  removeWorkspace,
  setActiveWorkspace,
  setOnboardingComplete,
  setWorkingDirectory,
  store
} from './store'
import { setupUpdater } from './updater'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function resolvePreload(): string {
  const base = path.join(__dirname, '../preload/index')
  if (fs.existsSync(`${base}.mjs`)) return `${base}.mjs`
  if (fs.existsSync(`${base}.js`)) return `${base}.js`
  if (fs.existsSync(`${base}.cjs`)) return `${base}.cjs`
  return `${base}.js`
}

let mainWindow: BrowserWindow | null = null

const gitInstances = new Map<string, ReturnType<typeof simpleGit>>()
const activeFetches = new Map<string, ChildProcess>()

function createWindow(): void {
  const mainWindowState = windowStateKeeper({
    defaultWidth: 1200,
    defaultHeight: 800,
    path: path.join(app.getPath('userData'), 'window-state.json')
  })

  mainWindow = new BrowserWindow({
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: resolvePreload(),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindowState.manage(mainWindow)

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  createWindow()
  setupUpdater()
  setupContextMenu()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('select-folder', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  })
  return result.canceled ? null : result.filePaths[0]
})

interface SerializableStatus {
  current: string
  modified: string[]
  staged: string[]
  not_added: string[]
}

interface SerializableLogEntry {
  hash: string
  message: string
  author_name: string
  date: string
  parents: string[]
  refs: string
}

interface SerializableLog {
  all: SerializableLogEntry[]
  total: number
}

const GRAPH_LOG_FORMAT = {
  hash: '%H',
  date: '%aI',
  message: '%s',
  refs: '%D',
  body: '',
  author_name: '%aN',
  author_email: '%aE',
  parents: '%P'
} as const

const GRAPH_LOG_FLAGS = {
  '--branches': null,
  '--remotes': null,
  '--date-order': null
}

interface SerializableBranches {
  current: string
  all: string[]
  remotes: string[]
  tags: string[]
}

function serializeStatus(
  status: Awaited<ReturnType<ReturnType<typeof simpleGit>['status']>>
): SerializableStatus {
  return {
    current: status.current ?? '',
    modified: [...status.modified],
    staged: [...status.staged],
    not_added: [...status.not_added]
  }
}

function serializeLog(
  log: Awaited<ReturnType<ReturnType<typeof simpleGit>['log']>>
): SerializableLog {
  return {
    total: log.total,
    all: log.all.map((entry) => {
      const raw = entry as typeof entry & { parents?: string; refs?: string }
      const parents = raw.parents ? raw.parents.split(' ').filter(Boolean) : []
      return {
        hash: entry.hash,
        message: entry.message,
        author_name: entry.author_name,
        date: entry.date,
        parents,
        refs: raw.refs ?? ''
      }
    })
  }
}

function serializeBranches(
  branches: Awaited<ReturnType<ReturnType<typeof simpleGit>['branch']>>,
  tags: Awaited<ReturnType<ReturnType<typeof simpleGit>['tags']>>
): SerializableBranches {
  const local: string[] = []
  const remotes: string[] = []
  for (const name of branches.all) {
    if (name.startsWith('remotes/')) {
      const stripped = name.slice('remotes/'.length)
      if (stripped.includes(' -> ')) continue
      remotes.push(stripped)
    } else {
      local.push(name)
    }
  }
  return {
    current: branches.current ?? '',
    all: local,
    remotes,
    tags: [...tags.all]
  }
}

function serializeRemotes(
  remotes: Array<{ name: string; refs: { fetch: string; push: string } }>
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const r of remotes) {
    if (r.refs?.fetch) result[r.name] = r.refs.fetch
  }
  return result
}

async function resolveDefaultBranch(
  git: ReturnType<typeof simpleGit>,
  currentLocal: string | undefined
): Promise<string | undefined> {
  try {
    const out = await git.raw(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
    const name = out.trim()
    if (name.startsWith('origin/')) return name.slice('origin/'.length)
  } catch {
    // origin/HEAD not set (uncommon clone state or no origin remote)
  }
  return currentLocal && currentLocal !== 'HEAD' ? currentLocal : undefined
}

ipcMain.handle('open-repo', async (event, repoPath: string) => {
  const key = normalizeRepoPath(repoPath)
  try {
    const git = getOrCreateGit(gitInstances, key)
    const isRepo = await git.checkIsRepo()

    if (!isRepo) {
      gitInstances.delete(key)
      return { success: false, error: 'Not a git repository' }
    }

    addRecentRepo(key)

    const remotes = await git.getRemotes(true)
    const defaultBranch = await resolveDefaultBranch(git, undefined)

    startWatching(key, event.sender)

    return {
      success: true,
      remotes: serializeRemotes(remotes),
      defaultBranch,
      path: key
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('get-branches', async (_, repoPath: string) => {
  const git = lookupGit(gitInstances, repoPath)
  if (!git) return { success: false, error: 'No repository open' }
  try {
    const [branches, tags] = await Promise.all([git.branch(['-a']), git.tags()])
    return { success: true, branches: serializeBranches(branches, tags) }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('close-repo', async (_, repoPath: string) => {
  const key = normalizeRepoPath(repoPath)
  gitInstances.delete(key)
  const proc = activeFetches.get(key)
  if (proc && !proc.killed) proc.kill()
  activeFetches.delete(key)
  await stopWatching(key)
  return { success: true }
})

ipcMain.handle('git-fetch', async (_, repoPath: string) => {
  const key = normalizeRepoPath(repoPath)
  if (!gitInstances.has(key)) {
    return { success: false, error: 'No repository open' }
  }

  const proc = spawn('git', ['-C', key, 'fetch', '--prune'], {
    stdio: ['ignore', 'ignore', 'pipe']
  })

  if (!tryReserveFetch(activeFetches, key, proc)) {
    if (!proc.killed) proc.kill()
    return { success: true, skipped: true }
  }

  return new Promise<{ success: boolean; skipped?: boolean; error?: string }>((resolve) => {
    let stderrBuf = ''
    proc.stderr?.setEncoding('utf8')
    proc.stderr?.on('data', (chunk: string) => {
      stderrBuf += chunk
      if (stderrBuf.length > 4096) stderrBuf = stderrBuf.slice(-4096)
    })

    proc.on('error', (err) => {
      if (activeFetches.get(key) === proc) activeFetches.delete(key)
      resolve({ success: false, error: err.message })
    })

    proc.on('close', (code) => {
      if (activeFetches.get(key) === proc) activeFetches.delete(key)
      if (code === 0) {
        resolve({ success: true })
      } else {
        resolve({
          success: false,
          error: stderrBuf.trim() || `git fetch exited with code ${code}`
        })
      }
    })
  })
})

ipcMain.handle('get-status', async (_, repoPath: string) => {
  const git = lookupGit(gitInstances, repoPath)
  if (!git) return { success: false, error: 'No repository open' }
  try {
    const status = await git.status()
    return { success: true, status: serializeStatus(status) }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('stage-file', async (_, repoPath: string, file: string) => {
  const git = lookupGit(gitInstances, repoPath)
  if (!git) return { success: false, error: 'No repository open' }
  try {
    await git.add(file)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('unstage-file', async (_, repoPath: string, file: string) => {
  const git = lookupGit(gitInstances, repoPath)
  if (!git) return { success: false, error: 'No repository open' }
  try {
    await git.reset(['HEAD', file])
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('commit', async (_, repoPath: string, message: string) => {
  const git = lookupGit(gitInstances, repoPath)
  if (!git) return { success: false, error: 'No repository open' }
  try {
    const result = await git.commit(message)
    return {
      success: true,
      result: {
        commit: result.commit,
        branch: result.branch,
        summary: { ...result.summary }
      }
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('get-log', async (_, repoPath: string, maxCount?: number) => {
  const git = lookupGit(gitInstances, repoPath)
  if (!git) return { success: false, error: 'No repository open' }
  try {
    const logOptions: Record<string, unknown> = {
      format: GRAPH_LOG_FORMAT,
      ...GRAPH_LOG_FLAGS
    }
    if (typeof maxCount === 'number' && maxCount > 0) logOptions.maxCount = maxCount
    const log = await git.log(logOptions)
    return { success: true, log: serializeLog(log) }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

const FS_SEP = '\x1F'
const RS_SEP = '\x00'
const STREAM_FORMAT = ['%H', '%P', '%aI', '%aN', '%s', '%D'].join(FS_SEP)
const STREAM_BATCH_SIZE = 500

const activeLogStreams = new Map<number, ReturnType<typeof spawn>>()

function killActiveStream(webContentsId: number) {
  const existing = activeLogStreams.get(webContentsId)
  if (existing && !existing.killed) {
    existing.kill()
  }
  activeLogStreams.delete(webContentsId)
}

ipcMain.handle('start-log-stream', async (event, repoPath: string) => {
  const key = normalizeRepoPath(repoPath)
  const webContents = event.sender
  const webContentsId = webContents.id

  killActiveStream(webContentsId)

  return new Promise<{ success: boolean; error?: string }>((resolve) => {
    let resolved = false
    const finishOk = () => {
      if (resolved) return
      resolved = true
      resolve({ success: true })
    }
    const finishErr = (message: string) => {
      if (resolved) return
      resolved = true
      resolve({ success: false, error: message })
    }

    const proc = spawn(
      'git',
      [
        '-C',
        key,
        'log',
        '-z',
        '--branches',
        '--remotes',
        '--date-order',
        `--format=${STREAM_FORMAT}`
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )
    activeLogStreams.set(webContentsId, proc)

    let buffer = ''
    let batch: SerializableLogEntry[] = []

    const send = (done: boolean) => {
      if (webContents.isDestroyed()) return
      if (batch.length === 0 && !done) return
      webContents.send('log-chunk', {
        repoPath: key,
        commits: batch,
        done
      })
      batch = []
    }

    proc.stdout?.setEncoding('utf8')
    proc.stdout?.on('data', (chunk: string) => {
      buffer += chunk
      let idx = buffer.indexOf(RS_SEP)
      while (idx !== -1) {
        const record = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 1)
        if (record) {
          const fields = record.split(FS_SEP)
          if (fields.length >= 6) {
            const [hash, parentsStr, date, author_name, message, refs] = fields
            batch.push({
              hash,
              message: message ?? '',
              author_name: author_name ?? '',
              date: date ?? '',
              parents: parentsStr ? parentsStr.split(' ').filter(Boolean) : [],
              refs: refs ?? ''
            })
            if (batch.length >= STREAM_BATCH_SIZE) send(false)
          }
        }
        idx = buffer.indexOf(RS_SEP)
      }
    })

    let stderrBuf = ''
    proc.stderr?.setEncoding('utf8')
    proc.stderr?.on('data', (chunk: string) => {
      stderrBuf += chunk
      if (stderrBuf.length > 4096) stderrBuf = stderrBuf.slice(-4096)
    })

    proc.on('error', (err) => {
      activeLogStreams.delete(webContentsId)
      if (!webContents.isDestroyed()) {
        webContents.send('log-chunk', {
          repoPath: key,
          commits: [],
          done: true,
          error: err.message
        })
      }
      finishErr(err.message)
    })

    proc.on('close', async (code) => {
      if (activeLogStreams.get(webContentsId) !== proc) return
      activeLogStreams.delete(webContentsId)

      if (code !== 0 && code !== null) {
        if (!webContents.isDestroyed()) {
          webContents.send('log-chunk', {
            repoPath: key,
            commits: [],
            done: true,
            error: stderrBuf.trim() || `git log exited with code ${code}`
          })
        }
        finishErr(stderrBuf.trim() || `git log exited with code ${code}`)
        return
      }

      send(false)
      if (!webContents.isDestroyed()) {
        webContents.send('log-chunk', { repoPath: key, commits: [], done: true })
      }
      finishOk()
    })
  })
})

ipcMain.handle('cancel-log-stream', (event) => {
  killActiveStream(event.sender.id)
  return { success: true }
})

ipcMain.handle('get-recent-repos', () => {
  return getRecentRepos()
})

ipcMain.handle('get-store-value', (_, key: string) => {
  return store.get(key as never)
})

ipcMain.handle('set-store-value', (_, key: string, value: unknown) => {
  store.set(key as never, value as never)
})

ipcMain.handle('get-working-directory', () => {
  return getWorkingDirectory()
})

ipcMain.handle('set-working-directory', (_, dir: string) => {
  setWorkingDirectory(dir)
})

ipcMain.handle('get-workspaces', () => {
  return getWorkspaces()
})

ipcMain.handle('add-workspace', (_, path: string) => {
  return addWorkspace(path)
})

ipcMain.handle('remove-workspace', (_, path: string) => {
  return removeWorkspace(path)
})

ipcMain.handle('get-active-workspace', () => {
  return getActiveWorkspace()
})

ipcMain.handle('set-active-workspace', (_, path: string | null) => {
  setActiveWorkspace(path)
})

ipcMain.handle('get-onboarding-complete', () => {
  return isOnboardingComplete()
})

ipcMain.handle('set-onboarding-complete', (_, complete: boolean) => {
  setOnboardingComplete(complete)
})

ipcMain.handle('scan-for-repos', async (_, dirPath: string) => {
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
    const repos: string[] = []

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const fullPath = path.join(dirPath, entry.name)
        try {
          const git = simpleGit(fullPath)
          const isRepo = await git.checkIsRepo()
          if (isRepo) {
            repos.push(fullPath)
          }
        } catch {
          // Not a git repo, skip
        }
      }
    }

    return { success: true, repos }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
})

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import windowStateKeeperModule from 'electron-window-state'
import { simpleGit } from 'simple-git'

const windowStateKeeper = windowStateKeeperModule.default || windowStateKeeperModule

import { setupContextMenu } from './menu'
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
  // electron-vite may output .mjs (ESM) or .js depending on build mode
  if (fs.existsSync(`${base}.mjs`)) return `${base}.mjs`
  if (fs.existsSync(`${base}.js`)) return `${base}.js`
  if (fs.existsSync(`${base}.cjs`)) return `${base}.cjs`
  // Fallback — will error clearly if missing
  return `${base}.js`
}

let mainWindow: BrowserWindow | null = null

// One SimpleGit instance per opened repo path — tabs in the renderer can each
// hold a different repo, and each operation passes the repoPath so the right
// instance is used.
const gitInstances = new Map<string, ReturnType<typeof simpleGit>>()

function getGit(repoPath: string) {
  let g = gitInstances.get(repoPath)
  if (!g) {
    g = simpleGit(repoPath)
    gitInstances.set(repoPath, g)
  }
  return g
}

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

// IPC Handlers
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

// Custom log format that includes parent hashes (%P) so the renderer can draw
// branch/merge topology. `git.log` defaults omit parents.
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

// Walk only branch refs (local + remote-tracking). Intentionally NOT `--all`:
// `--all` pulls in stash, notes, dangling commits, and detached HEAD-only
// commits, which the user has opted out of seeing. `--date-order` keeps rows
// in time order so the lane layout stays predictable across merges.
const GRAPH_LOG_FLAGS = {
  '--branches': null,
  '--remotes': null,
  '--date-order': null
}

interface SerializableBranches {
  current: string
  all: string[]
}

// simple-git returns class instances (StatusResult, LogResult, BranchSummary)
// with getters/methods that cannot be structured-cloned across the IPC bridge.
// Convert to plain JSON-safe shapes that match the renderer's types.
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

// Stash entries aren't reachable from any branch ref, so `git log --branches
// --remotes` skips them. Pull them in separately, and keep only the first
// parent (the commit they were created from) — the other parents are internal
// wip-on-index / wip-on-untracked commits we don't want cluttering the graph.
async function getStashEntries(git: ReturnType<typeof simpleGit>): Promise<SerializableLogEntry[]> {
  try {
    const raw = await git.raw(['stash', 'list', '--format=%H%x1F%P%x1F%aI%x1F%aN%x1F%s%x1F%gd'])
    if (!raw.trim()) return []
    return raw
      .trim()
      .split('\n')
      .map((line): SerializableLogEntry | null => {
        const [hash, parentsStr, date, author_name, message, gd] = line.split('\x1F')
        if (!hash) return null
        const firstParent = (parentsStr ?? '').split(' ').filter(Boolean)[0] ?? ''
        return {
          hash,
          message: message ?? '',
          author_name: author_name ?? '',
          date: date ?? '',
          parents: firstParent ? [firstParent] : [],
          refs: gd ?? ''
        }
      })
      .filter((e): e is SerializableLogEntry => e !== null)
  } catch {
    return []
  }
}

function mergeLogWithStashes(
  log: SerializableLog,
  stashes: SerializableLogEntry[]
): SerializableLog {
  if (stashes.length === 0) return log
  const seen = new Set(log.all.map((e) => e.hash))
  const extra = stashes.filter((s) => !seen.has(s.hash))
  const merged = [...log.all, ...extra].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0
  )
  return { total: merged.length, all: merged }
}

function serializeBranches(
  branches: Awaited<ReturnType<ReturnType<typeof simpleGit>['branchLocal']>>
): SerializableBranches {
  return {
    current: branches.current ?? '',
    all: [...branches.all]
  }
}

ipcMain.handle('open-repo', async (_, repoPath: string) => {
  try {
    const git = getGit(repoPath)
    const isRepo = await git.checkIsRepo()

    if (!isRepo) {
      gitInstances.delete(repoPath)
      return { success: false, error: 'Not a git repository' }
    }

    addRecentRepo(repoPath)

    // Only fetch the cheap things here. The log/stash walk is what makes big
    // repos feel slow on open — the renderer fetches it separately via
    // `get-log` so the UI shows status + branches immediately.
    const [status, branches] = await Promise.all([git.status(), git.branchLocal()])

    return {
      success: true,
      status: serializeStatus(status),
      branches: serializeBranches(branches),
      path: repoPath
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('close-repo', (_, repoPath: string) => {
  gitInstances.delete(repoPath)
  return { success: true }
})

ipcMain.handle('get-status', async (_, repoPath: string) => {
  const git = gitInstances.get(repoPath)
  if (!git) return { success: false, error: 'No repository open' }
  try {
    const status = await git.status()
    return { success: true, status: serializeStatus(status) }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('stage-file', async (_, repoPath: string, file: string) => {
  const git = gitInstances.get(repoPath)
  if (!git) return { success: false, error: 'No repository open' }
  try {
    await git.add(file)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('unstage-file', async (_, repoPath: string, file: string) => {
  const git = gitInstances.get(repoPath)
  if (!git) return { success: false, error: 'No repository open' }
  try {
    await git.reset(['HEAD', file])
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('commit', async (_, repoPath: string, message: string) => {
  const git = gitInstances.get(repoPath)
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

// `maxCount` is optional — when omitted (or 0), the full history is returned.
// We previously capped at 200 by default, which silently hid commits on big
// repos.
ipcMain.handle('get-log', async (_, repoPath: string, maxCount?: number) => {
  const git = gitInstances.get(repoPath)
  if (!git) return { success: false, error: 'No repository open' }
  try {
    const logOptions: Record<string, unknown> = {
      format: GRAPH_LOG_FORMAT,
      ...GRAPH_LOG_FLAGS
    }
    if (typeof maxCount === 'number' && maxCount > 0) logOptions.maxCount = maxCount
    const [log, stashes] = await Promise.all([git.log(logOptions), getStashEntries(git)])
    return { success: true, log: mergeLogWithStashes(serializeLog(log), stashes) }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

// Streaming log: spawn `git log` directly, parse its stdout in chunks, and
// forward small batches of commits to the renderer as they arrive. The
// renderer never has to deserialize one huge IPC payload, so its main thread
// stays responsive even on giant repos.
//
// Wire format: fields within a commit are separated by 0x1F (US); commits
// are terminated by 0x00 (NUL), produced by git's `-z` flag (NUL can't go
// in the spawn args directly — Node forbids it). Both bytes are safe — they
// can't appear inside any field git produces here.
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
  const webContents = event.sender
  const webContentsId = webContents.id

  // Cancel any in-flight stream for this window — switching repos shouldn't
  // leak old git processes or interleave their chunks.
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
        repoPath,
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
      // Send a chunk if there are commits OR a terminal `done` marker.
      if (batch.length === 0 && !done) return
      webContents.send('log-chunk', {
        repoPath,
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
      // Keep stderr bounded so a chatty git can't grow this unboundedly.
      if (stderrBuf.length > 4096) stderrBuf = stderrBuf.slice(-4096)
    })

    proc.on('error', (err) => {
      activeLogStreams.delete(webContentsId)
      if (!webContents.isDestroyed()) {
        webContents.send('log-chunk', { repoPath, commits: [], done: true, error: err.message })
      }
      finishErr(err.message)
    })

    proc.on('close', async (code) => {
      // Was this stream replaced by a newer one? If so, don't send anything —
      // the new stream owns the channel now.
      if (activeLogStreams.get(webContentsId) !== proc) return
      activeLogStreams.delete(webContentsId)

      if (code !== 0 && code !== null) {
        if (!webContents.isDestroyed()) {
          webContents.send('log-chunk', {
            repoPath,
            commits: [],
            done: true,
            error: stderrBuf.trim() || `git log exited with code ${code}`
          })
        }
        finishErr(stderrBuf.trim() || `git log exited with code ${code}`)
        return
      }

      // Flush remaining commits, then append stashes, then send the terminal
      // done marker.
      send(false)
      try {
        const git = gitInstances.get(repoPath) ?? simpleGit(repoPath)
        const stashes = await getStashEntries(git)
        if (stashes.length > 0 && !webContents.isDestroyed()) {
          webContents.send('log-chunk', {
            repoPath,
            commits: stashes,
            done: false
          })
        }
      } catch {
        // stashes are best-effort
      }
      if (!webContents.isDestroyed()) {
        webContents.send('log-chunk', { repoPath, commits: [], done: true })
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

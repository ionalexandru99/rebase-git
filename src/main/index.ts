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
  getRecentRepos,
  getWorkingDirectory,
  isOnboardingComplete,
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
let currentGit: ReturnType<typeof simpleGit> | null = null

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
}

interface SerializableLog {
  all: SerializableLogEntry[]
  total: number
}

interface SerializableBranches {
  current: string
  all: string[]
}

// simple-git returns class instances (StatusResult, LogResult, BranchSummary)
// with getters/methods that cannot be structured-cloned across the IPC bridge.
// Convert to plain JSON-safe shapes that match the renderer's types.
function serializeStatus(status: Awaited<ReturnType<ReturnType<typeof simpleGit>['status']>>): SerializableStatus {
  return {
    current: status.current ?? '',
    modified: [...status.modified],
    staged: [...status.staged],
    not_added: [...status.not_added]
  }
}

function serializeLog(log: Awaited<ReturnType<ReturnType<typeof simpleGit>['log']>>): SerializableLog {
  return {
    total: log.total,
    all: log.all.map((entry) => ({
      hash: entry.hash,
      message: entry.message,
      author_name: entry.author_name,
      date: entry.date
    }))
  }
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
    currentGit = simpleGit(repoPath)
    const isRepo = await currentGit.checkIsRepo()

    if (!isRepo) {
      return { success: false, error: 'Not a git repository' }
    }

    addRecentRepo(repoPath)

    const [status, log, branches] = await Promise.all([
      currentGit.status(),
      currentGit.log({ maxCount: 20 }),
      currentGit.branchLocal()
    ])

    return {
      success: true,
      status: serializeStatus(status),
      log: serializeLog(log),
      branches: serializeBranches(branches),
      path: repoPath
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('get-status', async () => {
  if (!currentGit) return { success: false, error: 'No repository open' }
  try {
    const status = await currentGit.status()
    return { success: true, status: serializeStatus(status) }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('stage-file', async (_, file: string) => {
  if (!currentGit) return { success: false, error: 'No repository open' }
  try {
    await currentGit.add(file)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('unstage-file', async (_, file: string) => {
  if (!currentGit) return { success: false, error: 'No repository open' }
  try {
    await currentGit.reset(['HEAD', file])
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('commit', async (_, message: string) => {
  if (!currentGit) return { success: false, error: 'No repository open' }
  try {
    const result = await currentGit.commit(message)
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

ipcMain.handle('get-log', async (_, maxCount = 20) => {
  if (!currentGit) return { success: false, error: 'No repository open' }
  try {
    const log = await currentGit.log({ maxCount })
    return { success: true, log: serializeLog(log) }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
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

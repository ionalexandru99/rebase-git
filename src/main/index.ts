import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import windowStateKeeperModule from 'electron-window-state'
import { simpleGit } from 'simple-git'

const windowStateKeeper = windowStateKeeperModule.default || windowStateKeeperModule

import { setupContextMenu } from './menu'
import { addRecentRepo, getRecentRepos, store } from './store'
import { setupUpdater } from './updater'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function resolvePreload(): string {
  const base = path.join(__dirname, '../preload/index')
  // electron-vite may output .mjs (ESM) or .js depending on build mode
  if (fs.existsSync(base + '.mjs')) return base + '.mjs'
  if (fs.existsSync(base + '.js')) return base + '.js'
  if (fs.existsSync(base + '.cjs')) return base + '.cjs'
  // Fallback — will error clearly if missing
  return base + '.js'
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
      status,
      log,
      branches,
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
    return { success: true, status }
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
    return { success: true, result }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('get-log', async (_, maxCount = 20) => {
  if (!currentGit) return { success: false, error: 'No repository open' }
  try {
    const log = await currentGit.log({ maxCount })
    return { success: true, log }
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

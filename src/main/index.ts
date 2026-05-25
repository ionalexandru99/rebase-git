import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog } from 'electron'
import windowStateKeeperModule from 'electron-window-state'

const windowStateKeeper = windowStateKeeperModule.default || windowStateKeeperModule

import * as logStreamIpc from './ipc/log-stream'
import * as repoIpc from './ipc/repo'
import * as settingsIpc from './ipc/settings'
import * as workspaceIpc from './ipc/workspace'
import { setupContextMenu } from './menu'
import { wireProcessRecovery, wireWindowRecovery } from './recovery'
import { killSidecar, startSidecar } from './sidecar'
import { getTheme } from './store'
import { resolveBackgroundColor } from './theme'
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

function createWindow(): void {
  const mainWindowState = windowStateKeeper({
    defaultWidth: 1200,
    defaultHeight: 800,
    path: path.join(app.getPath('userData'), 'window-state.json')
  })

  const win = new BrowserWindow({
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: resolveBackgroundColor(getTheme()),
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: resolvePreload(),
      sandbox: false,
      contextIsolation: true
    }
  })
  mainWindow = win

  mainWindowState.manage(win)
  wireWindowRecovery(win)

  let shown = false
  const showOnce = (): void => {
    if (shown || win.isDestroyed()) return
    shown = true
    win.show()
  }
  win.once('ready-to-show', showOnce)
  win.webContents.once('did-finish-load', showOnce)
  setTimeout(showOnce, 4000)

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/index.html`)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  win.on('closed', () => {
    mainWindow = null
  })
}

function registerIpcHandlers(): void {
  repoIpc.register()
  logStreamIpc.register()
  workspaceIpc.register(() => mainWindow)
  settingsIpc.register()
}

app.whenReady().then(async () => {
  try {
    await startSidecar()
  } catch (error: unknown) {
    console.error('[main] sidecar failed to start', error)
    dialog.showErrorBox('Rebase', 'Git sidecar failed to start. The app will exit.')
    app.quit()
    return
  }
  registerIpcHandlers()
  wireProcessRecovery()
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

app.on('before-quit', () => {
  void killSidecar()
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void killSidecar().finally(() => app.exit(0))
  })
}

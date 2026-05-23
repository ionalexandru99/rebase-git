import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow } from 'electron'
import windowStateKeeperModule from 'electron-window-state'

const windowStateKeeper = windowStateKeeperModule.default || windowStateKeeperModule

import * as fetchIpc from './ipc/fetch'
import * as logIpc from './ipc/log'
import * as logStreamIpc from './ipc/log-stream'
import * as repoIpc from './ipc/repo'
import * as settingsIpc from './ipc/settings'
import * as statusIpc from './ipc/status'
import * as workspaceIpc from './ipc/workspace'
import { setupContextMenu } from './menu'
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

function registerIpcHandlers(): void {
  repoIpc.register()
  statusIpc.register()
  logIpc.register()
  logStreamIpc.register()
  fetchIpc.register()
  workspaceIpc.register(() => mainWindow)
  settingsIpc.register()
}

app.whenReady().then(() => {
  registerIpcHandlers()
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

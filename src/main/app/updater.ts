import { Channel } from '@shared/channels'
import { parseOrThrow } from '@shared/codec'
import {
  type UpdatePreferences,
  UpdatePreferencesSchema,
  type UpdaterActionResult,
  UpdaterStateSchema
} from '@shared/schemas/ipc'
import { app, type BrowserWindow, ipcMain } from 'electron'
import log from 'electron-log'
import electronUpdater from 'electron-updater'
import { getUpdatePreferences, setUpdatePreferences } from '../store/index'
import { createUpdatePoller } from './update-poller'
import {
  createInitialUpdaterState,
  describeRejectedUpdaterAction,
  reduceUpdaterState,
  type UpdaterAction,
  type UpdaterEvent,
  type UpdaterSupport
} from './update-state'

const { autoUpdater } = electronUpdater

const STARTUP_CHECK_DELAY_MS = 30_000
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

function detectUpdaterSupport(): UpdaterSupport {
  if (!app.isPackaged) {
    return {
      supported: false,
      reason:
        'This build runs straight from source, so it cannot replace itself. Rebuild to pick up new versions.'
    }
  }
  if (process.env.REBASE_ENABLE_UPDATER !== '1') {
    return {
      supported: false,
      reason:
        'Automatic updates are switched off in this build. Get new versions from the releases page.'
    }
  }
  return { supported: true }
}

export function setupUpdater(getWindow: () => BrowserWindow | null): void {
  const support = detectUpdaterSupport()
  let state = createInitialUpdaterState(app.getVersion(), support)

  const pushState = (): void => {
    const window = getWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send(Channel.updaterStateChanged, parseOrThrow(UpdaterStateSchema, state))
    }
  }

  const dispatch = (event: UpdaterEvent): void => {
    state = reduceUpdaterState(state, event)
    pushState()
  }

  const applyPreferences = (preferences: UpdatePreferences): void => {
    autoUpdater.autoDownload = preferences.downloadInBackground
    autoUpdater.autoInstallOnAppQuit = preferences.installOnQuit
  }

  const runCheck = (): void => {
    autoUpdater.checkForUpdates().catch((error: unknown) => {
      log.warn('[updater] check for updates failed', error)
    })
  }

  const startDownload = (): void => {
    dispatch({ type: 'download-started' })
    autoUpdater.downloadUpdate().catch((error: unknown) => {
      log.warn('[updater] download failed', error)
    })
  }

  const guardedAction = (action: UpdaterAction, run: () => void): UpdaterActionResult => {
    const reason = describeRejectedUpdaterAction(state, action)
    if (reason !== null) {
      return { _tag: 'Rejected', reason }
    }
    run()
    return { _tag: 'Started' }
  }

  ipcMain.handle(Channel.getUpdaterState, () => parseOrThrow(UpdaterStateSchema, state))
  ipcMain.handle(Channel.getUpdatePreferences, () =>
    parseOrThrow(UpdatePreferencesSchema, getUpdatePreferences())
  )
  ipcMain.handle(Channel.setUpdatePreferences, (_, payload: unknown) => {
    const decoded = parseOrThrow(UpdatePreferencesSchema, payload)
    setUpdatePreferences(decoded)
    if (support.supported) {
      applyPreferences(decoded)
    }
  })
  ipcMain.handle(Channel.checkForUpdates, () => guardedAction('check', runCheck))
  ipcMain.handle(Channel.downloadUpdate, () => guardedAction('download', startDownload))
  ipcMain.handle(Channel.installUpdate, () =>
    guardedAction('install', () => autoUpdater.quitAndInstall())
  )

  if (!support.supported) {
    return
  }

  log.transports.file.level = 'info'
  autoUpdater.logger = log
  applyPreferences(getUpdatePreferences())

  autoUpdater.on('checking-for-update', () => {
    dispatch({ type: 'checking' })
  })
  autoUpdater.on('update-available', (info) => {
    dispatch({ type: 'update-available', version: info.version, at: new Date().toISOString() })
  })
  autoUpdater.on('update-not-available', () => {
    dispatch({ type: 'update-not-available', at: new Date().toISOString() })
  })
  autoUpdater.on('download-progress', (progress) => {
    dispatch({ type: 'download-progress', percent: progress.percent })
  })
  autoUpdater.on('update-downloaded', (info) => {
    dispatch({ type: 'update-downloaded', version: info.version })
  })
  autoUpdater.on('error', (error) => {
    dispatch({ type: 'update-error', message: error.message, at: new Date().toISOString() })
  })

  const poller = createUpdatePoller({
    startupDelayMs: STARTUP_CHECK_DELAY_MS,
    intervalMs: CHECK_INTERVAL_MS,
    runCheck: () => {
      if (describeRejectedUpdaterAction(state, 'check') === null) {
        runCheck()
      }
    }
  })
  poller.start()
  app.on('before-quit', poller.stop)
}

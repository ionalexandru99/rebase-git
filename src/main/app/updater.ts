import { Channel } from '@shared/channels'
import { parseOrThrow } from '@shared/codec'
import {
  type UpdateChannel,
  UpdateChannelSchema,
  type UpdatePreferences,
  UpdatePreferencesSchema,
  type UpdaterActionResult,
  UpdaterStateSchema
} from '@shared/schemas/ipc'
import { app, type BrowserWindow, ipcMain } from 'electron'
import log from 'electron-log'
import electronUpdater from 'electron-updater'
import {
  getStoredUpdateChannel,
  getUpdatePreferences,
  setStoredUpdateChannel,
  setUpdatePreferences
} from '../store/index'
import {
  describeChannelChangeBlocker,
  resolveUpdateChannel,
  updaterChannelProfile,
  versionBelongsToChannel
} from './update-channel'
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
  const currentVersion = app.getVersion()
  let state = createInitialUpdaterState(currentVersion, support)
  let channel = resolveUpdateChannel(getStoredUpdateChannel(), currentVersion)
  let installing = false

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

  const applyChannel = (): void => {
    const profile = updaterChannelProfile(channel, currentVersion)
    if (profile.channel !== null) {
      autoUpdater.channel = profile.channel
    }
    autoUpdater.allowPrerelease = profile.allowPrerelease
    autoUpdater.allowDowngrade = profile.allowDowngrade
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
    guardedAction('install', () => {
      installing = true
      autoUpdater.quitAndInstall()
    })
  )
  ipcMain.handle(Channel.getUpdateChannel, () => parseOrThrow(UpdateChannelSchema, channel))
  ipcMain.handle(Channel.setUpdateChannel, (_, payload: unknown): UpdaterActionResult => {
    const requested: UpdateChannel = parseOrThrow(UpdateChannelSchema, payload)
    const blocker = describeChannelChangeBlocker(state.status, installing)
    if (blocker !== null) {
      return { _tag: 'Rejected', reason: blocker }
    }
    if (requested !== channel) {
      channel = requested
      setStoredUpdateChannel(requested)
      if (support.supported) {
        applyChannel()
        runCheck()
      }
    }
    return { _tag: 'Started' }
  })

  if (!support.supported) {
    return
  }

  log.transports.file.level = 'info'
  autoUpdater.logger = log
  applyPreferences(getUpdatePreferences())
  applyChannel()

  autoUpdater.on('checking-for-update', () => {
    dispatch({ type: 'checking' })
  })
  autoUpdater.on('update-available', (info) => {
    const at = new Date().toISOString()
    if (!versionBelongsToChannel(info.version, channel)) {
      log.warn('[updater] discarding update outside the selected channel', info.version, channel)
      dispatch({ type: 'update-not-available', at })
      return
    }
    dispatch({ type: 'update-available', version: info.version, at })
  })
  autoUpdater.on('update-not-available', () => {
    dispatch({ type: 'update-not-available', at: new Date().toISOString() })
  })
  autoUpdater.on('download-progress', (progress) => {
    dispatch({ type: 'download-progress', percent: progress.percent })
  })
  autoUpdater.on('update-downloaded', (info) => {
    if (!versionBelongsToChannel(info.version, channel)) {
      log.warn('[updater] discarding download outside the selected channel', info.version, channel)
      return
    }
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

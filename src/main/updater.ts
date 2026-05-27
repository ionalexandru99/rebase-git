import { app } from 'electron'
import log from 'electron-log'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

export function setupUpdater(): void {
  if (!app.isPackaged) {
    return
  }

  log.transports.file.level = 'info'
  autoUpdater.logger = log

  autoUpdater.on('checking-for-update', () => {
    log.info('Checking for update...')
  })

  autoUpdater.on('update-available', (info) => {
    log.info('Update available.', info)
  })

  autoUpdater.on('update-not-available', (info) => {
    log.info('Update not available.', info)
  })

  autoUpdater.on('error', (err) => {
    log.error(`Error in auto-updater. ${err}`)
  })

  autoUpdater.on('download-progress', (progressObj) => {
    const logMessage = `Download speed: ${progressObj.bytesPerSecond} - Downloaded ${progressObj.percent}% (${progressObj.transferred}/${progressObj.total})`
    log.info(logMessage)
  })

  autoUpdater.on('update-downloaded', (info) => {
    log.info('Update downloaded', info)
  })

  const checkForUpdates = () => {
    autoUpdater.checkForUpdatesAndNotify()
  }
  if (app.isReady()) {
    checkForUpdates()
  } else {
    app.on('ready', checkForUpdates)
  }
}

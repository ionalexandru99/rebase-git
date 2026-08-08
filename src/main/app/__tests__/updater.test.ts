import { Channel } from '@shared/channels'
import type { UpdateChannel, UpdaterActionResult, UpdaterState } from '@shared/schemas/ipc'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setupUpdater } from '../updater'

const mocks = vi.hoisted(() => {
  const ipcHandlers = new Map<string, (event: unknown, payload?: unknown) => unknown>()
  const appLifecycleHandlers = new Map<string, () => void>()
  const updaterListeners = new Map<string, Array<(...args: unknown[]) => void>>()
  const autoUpdater = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    allowPrerelease: false,
    allowDowngrade: false,
    channel: null as string | null,
    logger: null as unknown,
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    on(event: string, handler: (...args: unknown[]) => void) {
      updaterListeners.set(event, [...(updaterListeners.get(event) ?? []), handler])
      return autoUpdater
    },
    emit(event: string, ...args: unknown[]) {
      for (const handler of updaterListeners.get(event) ?? []) {
        handler(...args)
      }
    },
    removeAllListeners() {
      updaterListeners.clear()
    }
  }
  const store = {
    getStoredUpdateChannel: vi.fn(),
    setStoredUpdateChannel: vi.fn(),
    getUpdatePreferences: vi.fn(),
    setUpdatePreferences: vi.fn()
  }
  const app = {
    isPackaged: true,
    getVersion: vi.fn(() => '1.2.0'),
    on: vi.fn((event: string, handler: () => void) => {
      appLifecycleHandlers.set(event, handler)
    })
  }
  const ipcMain = {
    handle: vi.fn((channel: string, handler: (event: unknown, payload?: unknown) => unknown) => {
      ipcHandlers.set(channel, handler)
    })
  }
  const log = {
    transports: { file: { level: 'silly' } },
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
  return { ipcHandlers, appLifecycleHandlers, autoUpdater, store, app, ipcMain, log }
})

vi.mock('electron', () => ({ app: mocks.app, ipcMain: mocks.ipcMain }))
vi.mock('electron-log', () => ({ default: mocks.log }))
vi.mock('electron-updater', () => ({ default: { autoUpdater: mocks.autoUpdater } }))
vi.mock('../../store/index', () => mocks.store)

const flushMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) {
    await Promise.resolve()
  }
}

const readState = (): UpdaterState =>
  mocks.ipcHandlers.get(Channel.getUpdaterState)?.(null) as UpdaterState

const invokeCheck = (): UpdaterActionResult =>
  mocks.ipcHandlers.get(Channel.checkForUpdates)?.(null) as UpdaterActionResult

const invokeInstall = (): UpdaterActionResult =>
  mocks.ipcHandlers.get(Channel.installUpdate)?.(null) as UpdaterActionResult

const invokeSetChannel = (channel: UpdateChannel): UpdaterActionResult =>
  mocks.ipcHandlers.get(Channel.setUpdateChannel)?.(null, channel) as UpdaterActionResult

function startUpdater(options: { storedChannel: UpdateChannel | null }): void {
  mocks.store.getStoredUpdateChannel.mockReturnValue(options.storedChannel)
  setupUpdater(() => null)
}

describe('setupUpdater', () => {
  beforeEach(() => {
    process.env.REBASE_ENABLE_UPDATER = '1'
    mocks.store.getUpdatePreferences.mockReturnValue({
      downloadInBackground: true,
      installOnQuit: true
    })
    mocks.autoUpdater.checkForUpdates.mockResolvedValue(null)
  })

  afterEach(() => {
    mocks.appLifecycleHandlers.get('before-quit')?.()
    mocks.autoUpdater.removeAllListeners()
    mocks.ipcHandlers.clear()
    mocks.appLifecycleHandlers.clear()
    vi.clearAllMocks()
    delete process.env.REBASE_ENABLE_UPDATER
  })

  it('cancels the auto-download of a wrong-channel update and stays usable', async () => {
    startUpdater({ storedChannel: 'stable' })
    expect(mocks.autoUpdater.autoInstallOnAppQuit).toBe(true)

    const cancel = vi.fn()
    mocks.autoUpdater.checkForUpdates.mockImplementation(() => {
      mocks.autoUpdater.emit('checking-for-update')
      mocks.autoUpdater.emit('update-available', { version: '1.3.0-nightly.20260808.5' })
      return Promise.resolve({
        updateInfo: { version: '1.3.0-nightly.20260808.5' },
        cancellationToken: { cancel },
        downloadPromise: new Promise(() => {})
      })
    })

    expect(invokeCheck()._tag).toBe('Started')
    await flushMicrotasks()

    expect(cancel).toHaveBeenCalledOnce()
    expect(readState().status).toBe('up-to-date')

    mocks.autoUpdater.emit('download-progress', { percent: 35 })
    expect(readState().status).toBe('up-to-date')
    expect(readState().downloadPercent).toBeNull()

    mocks.autoUpdater.emit('update-downloaded', { version: '1.3.0-nightly.20260808.5' })
    expect(readState().status).toBe('up-to-date')
    expect(readState().availableVersion).toBeNull()
    expect(mocks.autoUpdater.autoInstallOnAppQuit).toBe(false)

    mocks.autoUpdater.checkForUpdates.mockResolvedValue(null)
    expect(invokeCheck()._tag).toBe('Started')
  })

  it('maps the stable profile to the latest channel so a nightly channel can be unset', () => {
    startUpdater({ storedChannel: 'nightly' })
    expect(mocks.autoUpdater.channel).toBe('nightly')

    expect(invokeSetChannel('stable')._tag).toBe('Started')

    expect(mocks.autoUpdater.channel).toBe('latest')
  })

  it('disarms a downloaded update when the channel switches away from it and re-arms on the next on-channel download', () => {
    startUpdater({ storedChannel: 'nightly' })

    mocks.autoUpdater.emit('checking-for-update')
    mocks.autoUpdater.emit('update-available', { version: '1.3.0-nightly.20260808.5' })
    mocks.autoUpdater.emit('update-downloaded', { version: '1.3.0-nightly.20260808.5' })
    expect(readState().status).toBe('downloaded')
    expect(mocks.autoUpdater.autoInstallOnAppQuit).toBe(true)

    expect(invokeSetChannel('stable')._tag).toBe('Started')

    expect(mocks.autoUpdater.autoInstallOnAppQuit).toBe(false)
    expect(readState().status).not.toBe('downloaded')
    expect(readState().availableVersion).toBeNull()

    mocks.autoUpdater.emit('update-available', { version: '1.4.0' })
    mocks.autoUpdater.emit('update-downloaded', { version: '1.4.0' })

    expect(readState().status).toBe('downloaded')
    expect(readState().availableVersion).toBe('1.4.0')
    expect(mocks.autoUpdater.autoInstallOnAppQuit).toBe(true)
  })

  it('clears the installing flag when the install fails without quitting', () => {
    startUpdater({ storedChannel: 'stable' })

    mocks.autoUpdater.emit('update-available', { version: '1.4.0' })
    mocks.autoUpdater.emit('update-downloaded', { version: '1.4.0' })

    expect(invokeInstall()._tag).toBe('Started')
    expect(mocks.autoUpdater.quitAndInstall).toHaveBeenCalledOnce()
    expect(invokeSetChannel('nightly')).toEqual({
      _tag: 'Rejected',
      reason: 'The update is installing right now.'
    })

    mocks.autoUpdater.emit('error', new Error('the cached installer failed verification'))

    expect(invokeSetChannel('nightly')._tag).toBe('Started')
  })
})

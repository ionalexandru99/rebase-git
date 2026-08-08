import { parseOrThrow } from '@shared/codec'
import { BuildInfoSchema, Channel } from '@shared/schemas/ipc'
import { app, ipcMain, shell } from 'electron'
import log from 'electron-log'
import { describeBuildInfo, releaseNotesUrl } from '../app/build-info'

declare const __REBASE_COMMIT_SHA__: string

export function register(): void {
  ipcMain.handle(Channel.getBuildInfo, () =>
    parseOrThrow(
      BuildInfoSchema,
      describeBuildInfo({
        version: app.getVersion(),
        commitSha: __REBASE_COMMIT_SHA__,
        electronVersion: process.versions.electron,
        platform: process.platform,
        arch: process.arch
      })
    )
  )
  ipcMain.handle(Channel.revealLogsFolder, () => {
    shell.showItemInFolder(log.transports.file.getFile().path)
  })
  ipcMain.handle(Channel.openReleaseNotes, () =>
    shell.openExternal(releaseNotesUrl(app.getVersion()))
  )
}

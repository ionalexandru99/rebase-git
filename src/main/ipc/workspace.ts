import { parseOrThrow } from '@shared/codec'
import { ScanForRepos } from '@shared/rpc'
import { Channel, ScanForReposResponseSchema } from '@shared/schemas/ipc'
import { type BrowserWindow, dialog, ipcMain } from 'electron'
import { sidecarRpcCall } from '../sidecar'
import {
  addWorkspace,
  getActiveWorkspace,
  getRecentRepos,
  getWorkspaces,
  isOnboardingComplete,
  removeWorkspace,
  setActiveWorkspace,
  setOnboardingComplete
} from '../store'

export function register(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle('select-folder', async () => {
    const win = getMainWindow()
    if (!win) {
      return null
    }
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('get-recent-repos', () => getRecentRepos())

  ipcMain.handle('get-workspaces', () => getWorkspaces())
  ipcMain.handle('add-workspace', (_, workspacePath: string) => addWorkspace(workspacePath))
  ipcMain.handle('remove-workspace', (_, workspacePath: string) => removeWorkspace(workspacePath))

  ipcMain.handle('get-active-workspace', () => getActiveWorkspace())
  ipcMain.handle('set-active-workspace', (_, workspacePath: string | null) =>
    setActiveWorkspace(workspacePath)
  )

  ipcMain.handle('get-onboarding-complete', () => isOnboardingComplete())
  ipcMain.handle('set-onboarding-complete', (_, complete: boolean) =>
    setOnboardingComplete(complete)
  )

  ipcMain.handle(Channel.scanForRepos, async (_, dirPath: string) =>
    parseOrThrow(ScanForReposResponseSchema, await sidecarRpcCall(ScanForRepos._tag, { dirPath }))
  )
}

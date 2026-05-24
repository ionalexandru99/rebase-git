import { Channel, type ScanForReposResponse } from '@shared/schemas/ipc'
import { type BrowserWindow, dialog, ipcMain } from 'electron'
import { SidecarOp } from '../../sidecar/protocol'
import { sidecarRequest } from '../sidecar'
import {
  addWorkspace,
  getActiveWorkspace,
  getRecentRepos,
  getWorkingDirectory,
  getWorkspaces,
  isOnboardingComplete,
  removeWorkspace,
  setActiveWorkspace,
  setOnboardingComplete,
  setWorkingDirectory
} from '../store'

export function register(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle('select-folder', async () => {
    const win = getMainWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('get-recent-repos', () => getRecentRepos())

  ipcMain.handle('get-working-directory', () => getWorkingDirectory())
  ipcMain.handle('set-working-directory', (_, dir: string) => setWorkingDirectory(dir))

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

  ipcMain.handle(Channel.scanForRepos, (_, dirPath: string) =>
    sidecarRequest<ScanForReposResponse>(SidecarOp.scanForRepos, { dirPath })
  )
}

import fs from 'node:fs'
import path from 'node:path'
import { encodeOrThrow } from '@shared/codec'
import { Channel, ScanForReposResponse } from '@shared/schemas/ipc'
import { type BrowserWindow, dialog, ipcMain } from 'electron'
import { simpleGit } from 'simple-git'
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

  ipcMain.handle(Channel.scanForRepos, async (_, dirPath: string) => {
    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
      const repos: string[] = []

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const fullPath = path.join(dirPath, entry.name)
          try {
            const git = simpleGit(fullPath)
            const isRepo = await git.checkIsRepo()
            if (isRepo) {
              repos.push(fullPath)
            }
          } catch {}
        }
      }

      return encodeOrThrow(ScanForReposResponse, { _tag: 'Ok', repos })
    } catch (error) {
      return encodeOrThrow(ScanForReposResponse, {
        _tag: 'GitError',
        message: error instanceof Error ? error.message : String(error)
      })
    }
  })
}

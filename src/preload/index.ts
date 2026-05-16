import { contextBridge, ipcRenderer } from 'electron'

export interface IElectronAPI {
  selectFolder: () => Promise<string | null>
  openRepo: (path: string) => Promise<unknown>
  closeRepo: (path: string) => Promise<unknown>
  getStatus: (repoPath: string) => Promise<unknown>
  stageFile: (repoPath: string, file: string) => Promise<unknown>
  unstageFile: (repoPath: string, file: string) => Promise<unknown>
  commit: (repoPath: string, message: string) => Promise<unknown>
  getLog: (repoPath: string, maxCount?: number) => Promise<unknown>
  getRecentRepos: () => Promise<string[]>
  getStoreValue: (key: string) => Promise<unknown>
  setStoreValue: (key: string, value: unknown) => Promise<void>
  getWorkingDirectory: () => Promise<string | null>
  setWorkingDirectory: (dir: string) => Promise<void>
  getWorkspaces: () => Promise<string[]>
  addWorkspace: (path: string) => Promise<string[]>
  removeWorkspace: (path: string) => Promise<string[]>
  getActiveWorkspace: () => Promise<string | null>
  setActiveWorkspace: (path: string | null) => Promise<void>
  getOnboardingComplete: () => Promise<boolean>
  setOnboardingComplete: (complete: boolean) => Promise<void>
  scanForRepos: (dirPath: string) => Promise<{ success: boolean; repos?: string[]; error?: string }>
}

const api: IElectronAPI = {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  openRepo: (path: string) => ipcRenderer.invoke('open-repo', path),
  closeRepo: (path: string) => ipcRenderer.invoke('close-repo', path),
  getStatus: (repoPath: string) => ipcRenderer.invoke('get-status', repoPath),
  stageFile: (repoPath: string, file: string) => ipcRenderer.invoke('stage-file', repoPath, file),
  unstageFile: (repoPath: string, file: string) =>
    ipcRenderer.invoke('unstage-file', repoPath, file),
  commit: (repoPath: string, message: string) => ipcRenderer.invoke('commit', repoPath, message),
  getLog: (repoPath: string, maxCount?: number) =>
    ipcRenderer.invoke('get-log', repoPath, maxCount),
  getRecentRepos: () => ipcRenderer.invoke('get-recent-repos'),
  getStoreValue: (key: string) => ipcRenderer.invoke('get-store-value', key),
  setStoreValue: (key: string, value: unknown) => ipcRenderer.invoke('set-store-value', key, value),
  getWorkingDirectory: () => ipcRenderer.invoke('get-working-directory'),
  setWorkingDirectory: (dir: string) => ipcRenderer.invoke('set-working-directory', dir),
  getWorkspaces: () => ipcRenderer.invoke('get-workspaces'),
  addWorkspace: (path: string) => ipcRenderer.invoke('add-workspace', path),
  removeWorkspace: (path: string) => ipcRenderer.invoke('remove-workspace', path),
  getActiveWorkspace: () => ipcRenderer.invoke('get-active-workspace'),
  setActiveWorkspace: (path: string | null) => ipcRenderer.invoke('set-active-workspace', path),
  getOnboardingComplete: () => ipcRenderer.invoke('get-onboarding-complete'),
  setOnboardingComplete: (complete: boolean) =>
    ipcRenderer.invoke('set-onboarding-complete', complete),
  scanForRepos: (dirPath: string) => ipcRenderer.invoke('scan-for-repos', dirPath)
}

contextBridge.exposeInMainWorld('electronAPI', api)

declare global {
  interface Window {
    electronAPI: IElectronAPI
  }
}

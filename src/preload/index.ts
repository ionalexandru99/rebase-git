import { contextBridge, ipcRenderer } from 'electron'

export interface IElectronAPI {
  selectFolder: () => Promise<string | null>
  openRepo: (path: string) => Promise<unknown>
  getStatus: () => Promise<unknown>
  stageFile: (file: string) => Promise<unknown>
  unstageFile: (file: string) => Promise<unknown>
  commit: (message: string) => Promise<unknown>
  getLog: (maxCount?: number) => Promise<unknown>
  getRecentRepos: () => Promise<string[]>
  getStoreValue: (key: string) => Promise<unknown>
  setStoreValue: (key: string, value: unknown) => Promise<void>
  getWorkingDirectory: () => Promise<string | null>
  setWorkingDirectory: (dir: string) => Promise<void>
  getOnboardingComplete: () => Promise<boolean>
  setOnboardingComplete: (complete: boolean) => Promise<void>
  scanForRepos: (dirPath: string) => Promise<{ success: boolean; repos?: string[]; error?: string }>
}

const api: IElectronAPI = {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  openRepo: (path: string) => ipcRenderer.invoke('open-repo', path),
  getStatus: () => ipcRenderer.invoke('get-status'),
  stageFile: (file: string) => ipcRenderer.invoke('stage-file', file),
  unstageFile: (file: string) => ipcRenderer.invoke('unstage-file', file),
  commit: (message: string) => ipcRenderer.invoke('commit', message),
  getLog: (maxCount?: number) => ipcRenderer.invoke('get-log', maxCount),
  getRecentRepos: () => ipcRenderer.invoke('get-recent-repos'),
  getStoreValue: (key: string) => ipcRenderer.invoke('get-store-value', key),
  setStoreValue: (key: string, value: unknown) => ipcRenderer.invoke('set-store-value', key, value),
  getWorkingDirectory: () => ipcRenderer.invoke('get-working-directory'),
  setWorkingDirectory: (dir: string) => ipcRenderer.invoke('set-working-directory', dir),
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

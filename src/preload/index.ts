import { type BranchesResponse, Channel, type StatusResponse } from '@shared/schemas/ipc'
import { contextBridge, ipcRenderer } from 'electron'

export interface LogChunkEvent {
  repoPath: string
  commits: Array<{
    hash: string
    message: string
    author_name: string
    date: string
    parents: string[]
    refs: string
  }>
  done: boolean
  error?: string
}

export type RepoChangedEvent = {
  repoPath: string
  kind: 'refs' | 'workingTree'
}

export interface IElectronAPI {
  selectFolder: () => Promise<string | null>
  openRepo: (path: string) => Promise<unknown>
  closeRepo: (path: string) => Promise<unknown>
  getBranches: (repoPath: string) => Promise<BranchesResponse>
  getStatus: (repoPath: string) => Promise<StatusResponse>
  stageFile: (repoPath: string, file: string) => Promise<unknown>
  unstageFile: (repoPath: string, file: string) => Promise<unknown>
  commit: (repoPath: string, message: string) => Promise<unknown>
  fetchRepo: (repoPath: string) => Promise<{ success: boolean; skipped?: boolean; error?: string }>
  getLog: (repoPath: string, maxCount?: number) => Promise<unknown>
  startLogStream: (repoPath: string) => Promise<{ success: boolean; error?: string }>
  cancelLogStream: () => Promise<{ success: boolean }>
  onLogChunk: (cb: (chunk: LogChunkEvent) => void) => () => void
  onRepoChanged: (cb: (evt: RepoChangedEvent) => void) => () => void
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
  getBranches: (repoPath: string) => ipcRenderer.invoke(Channel.getBranches, repoPath),
  getStatus: (repoPath: string) => ipcRenderer.invoke(Channel.getStatus, repoPath),
  stageFile: (repoPath: string, file: string) => ipcRenderer.invoke('stage-file', repoPath, file),
  unstageFile: (repoPath: string, file: string) =>
    ipcRenderer.invoke('unstage-file', repoPath, file),
  commit: (repoPath: string, message: string) => ipcRenderer.invoke('commit', repoPath, message),
  fetchRepo: (repoPath: string) => ipcRenderer.invoke('git-fetch', repoPath),
  getLog: (repoPath: string, maxCount?: number) =>
    ipcRenderer.invoke('get-log', repoPath, maxCount),
  startLogStream: (repoPath: string) => ipcRenderer.invoke('start-log-stream', repoPath),
  cancelLogStream: () => ipcRenderer.invoke('cancel-log-stream'),
  onLogChunk: (cb: (chunk: LogChunkEvent) => void) => {
    const handler = (_event: unknown, chunk: LogChunkEvent) => cb(chunk)
    ipcRenderer.on('log-chunk', handler)
    return () => ipcRenderer.off('log-chunk', handler)
  },
  onRepoChanged: (cb: (evt: RepoChangedEvent) => void) => {
    const handler = (_event: unknown, evt: RepoChangedEvent) => cb(evt)
    ipcRenderer.on('repo-changed', handler)
    return () => ipcRenderer.off('repo-changed', handler)
  },
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

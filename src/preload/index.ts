import type { LogChunk, RepoChangedEvent } from '@shared/schemas/git'
import {
  type BranchesResponse,
  type CancelLogStreamResponse,
  Channel,
  type CommitResponse,
  type FetchResponse,
  type LogResponse,
  type OpenRepoResponse,
  type PersistedTabs,
  type RefTreeToggles,
  type ScanForReposResponse,
  type SidebarPrefs,
  type StageResponse,
  type StartLogStreamResponse,
  type StatusResponse,
  type UnstageResponse
} from '@shared/schemas/ipc'
import { contextBridge, ipcRenderer } from 'electron'

export type LogChunkEvent = LogChunk
export type { RepoChangedEvent }

export interface IElectronAPI {
  selectFolder: () => Promise<string | null>
  openRepo: (path: string) => Promise<OpenRepoResponse>
  closeRepo: (path: string) => Promise<void>
  getBranches: (repoPath: string) => Promise<BranchesResponse>
  getStatus: (repoPath: string) => Promise<StatusResponse>
  stageFile: (repoPath: string, file: string) => Promise<StageResponse>
  unstageFile: (repoPath: string, file: string) => Promise<UnstageResponse>
  commit: (repoPath: string, message: string) => Promise<CommitResponse>
  fetchRepo: (repoPath: string) => Promise<FetchResponse>
  getLog: (repoPath: string, maxCount?: number) => Promise<LogResponse>
  startLogStream: (repoPath: string) => Promise<StartLogStreamResponse>
  cancelLogStream: () => Promise<CancelLogStreamResponse>
  onLogChunk: (cb: (chunk: LogChunk) => void) => () => void
  onRepoChanged: (cb: (evt: RepoChangedEvent) => void) => () => void
  getRecentRepos: () => Promise<string[]>
  getSidebarPrefs: () => Promise<SidebarPrefs>
  setSidebarPrefs: (prefs: SidebarPrefs) => Promise<void>
  getRefTreeToggles: () => Promise<RefTreeToggles>
  setRefTreeToggles: (toggles: RefTreeToggles) => Promise<void>
  getPersistedTabs: () => Promise<PersistedTabs>
  setPersistedTabs: (state: PersistedTabs) => Promise<void>
  getWorkingDirectory: () => Promise<string | null>
  setWorkingDirectory: (dir: string) => Promise<void>
  getWorkspaces: () => Promise<string[]>
  addWorkspace: (path: string) => Promise<string[]>
  removeWorkspace: (path: string) => Promise<string[]>
  getActiveWorkspace: () => Promise<string | null>
  setActiveWorkspace: (path: string | null) => Promise<void>
  getOnboardingComplete: () => Promise<boolean>
  setOnboardingComplete: (complete: boolean) => Promise<void>
  scanForRepos: (dirPath: string) => Promise<ScanForReposResponse>
}

const api: IElectronAPI = {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  openRepo: (path: string) => ipcRenderer.invoke(Channel.openRepo, path),
  closeRepo: (path: string) => ipcRenderer.invoke(Channel.closeRepo, path),
  getBranches: (repoPath: string) => ipcRenderer.invoke(Channel.getBranches, repoPath),
  getStatus: (repoPath: string) => ipcRenderer.invoke(Channel.getStatus, repoPath),
  stageFile: (repoPath: string, file: string) =>
    ipcRenderer.invoke(Channel.stageFile, repoPath, file),
  unstageFile: (repoPath: string, file: string) =>
    ipcRenderer.invoke(Channel.unstageFile, repoPath, file),
  commit: (repoPath: string, message: string) =>
    ipcRenderer.invoke(Channel.commit, repoPath, message),
  fetchRepo: (repoPath: string) => ipcRenderer.invoke(Channel.fetchRepo, repoPath),
  getLog: (repoPath: string, maxCount?: number) =>
    ipcRenderer.invoke(Channel.getLog, repoPath, maxCount),
  startLogStream: (repoPath: string) => ipcRenderer.invoke(Channel.startLogStream, repoPath),
  cancelLogStream: () => ipcRenderer.invoke(Channel.cancelLogStream),
  onLogChunk: (cb: (chunk: LogChunk) => void) => {
    const handler = (_event: unknown, chunk: LogChunk) => cb(chunk)
    ipcRenderer.on(Channel.logChunk, handler)
    return () => ipcRenderer.off(Channel.logChunk, handler)
  },
  onRepoChanged: (cb: (evt: RepoChangedEvent) => void) => {
    const handler = (_event: unknown, evt: RepoChangedEvent) => cb(evt)
    ipcRenderer.on(Channel.repoChanged, handler)
    return () => ipcRenderer.off(Channel.repoChanged, handler)
  },
  getRecentRepos: () => ipcRenderer.invoke('get-recent-repos'),
  getSidebarPrefs: () => ipcRenderer.invoke(Channel.getSidebarPrefs),
  setSidebarPrefs: (prefs: SidebarPrefs) => ipcRenderer.invoke(Channel.setSidebarPrefs, prefs),
  getRefTreeToggles: () => ipcRenderer.invoke(Channel.getRefTreeToggles),
  setRefTreeToggles: (toggles: RefTreeToggles) =>
    ipcRenderer.invoke(Channel.setRefTreeToggles, toggles),
  getPersistedTabs: () => ipcRenderer.invoke(Channel.getPersistedTabs),
  setPersistedTabs: (state: PersistedTabs) =>
    ipcRenderer.invoke(Channel.setPersistedTabs, state),
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
  scanForRepos: (dirPath: string) => ipcRenderer.invoke(Channel.scanForRepos, dirPath)
}

contextBridge.exposeInMainWorld('electronAPI', api)

declare global {
  interface Window {
    electronAPI: IElectronAPI
  }
}

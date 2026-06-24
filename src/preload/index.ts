import { Channel } from '@shared/channels'
import type { LogChunk, RepoChangedEvent } from '@shared/schemas/git'
import type {
  CancelLogStreamResponse,
  OpenRepoResponse,
  PersistedTabs,
  RefTreeToggles,
  ScanForReposResponse,
  SidebarPrefs,
  StartLogStreamResponse
} from '@shared/schemas/ipc'
import type { LogStreamOptions } from '@shared/schemas/log-stream'
import { contextBridge, ipcRenderer } from 'electron'

export type LogChunkEvent = LogChunk
export type { RepoChangedEvent }

export interface IElectronAPI {
  selectFolder: () => Promise<string | null>
  openRepo: (path: string) => Promise<OpenRepoResponse>
  closeRepo: (path: string) => Promise<void>
  startLogStream: (repoPath: string, options?: LogStreamOptions) => Promise<StartLogStreamResponse>
  cancelLogStream: (repoPath?: string) => Promise<CancelLogStreamResponse>
  onLogChunk: (cb: (chunk: LogChunk) => void) => () => void
  onRepoChanged: (cb: (evt: RepoChangedEvent) => void) => () => void
  onSidecarRestarted: (cb: () => void) => () => void
  getRecentRepos: () => Promise<string[]>
  getSidebarPrefs: () => Promise<SidebarPrefs>
  setSidebarPrefs: (prefs: SidebarPrefs) => Promise<void>
  getRefTreeToggles: () => Promise<RefTreeToggles>
  setRefTreeToggles: (toggles: RefTreeToggles) => Promise<void>
  getPersistedTabs: () => Promise<PersistedTabs>
  setPersistedTabs: (state: PersistedTabs) => Promise<void>
  getWorkspaces: () => Promise<string[]>
  addWorkspace: (path: string) => Promise<string[]>
  removeWorkspace: (path: string) => Promise<string[]>
  getActiveWorkspace: () => Promise<string | null>
  setActiveWorkspace: (path: string | null) => Promise<void>
  getOnboardingComplete: () => Promise<boolean>
  setOnboardingComplete: (complete: boolean) => Promise<void>
  scanForRepos: (dirPath: string) => Promise<ScanForReposResponse>
  sidecarRequest: (op: string, body: Record<string, unknown>) => Promise<unknown>
}

const api: IElectronAPI = {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  openRepo: (path: string) => ipcRenderer.invoke(Channel.openRepo, path),
  closeRepo: (path: string) => ipcRenderer.invoke(Channel.closeRepo, path),
  startLogStream: (repoPath: string, options?: LogStreamOptions) =>
    ipcRenderer.invoke(Channel.startLogStream, repoPath, options),
  cancelLogStream: (repoPath?: string) =>
    ipcRenderer.invoke(Channel.cancelLogStream, repoPath ?? ''),
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
  onSidecarRestarted: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on(Channel.sidecarRestarted, handler)
    return () => ipcRenderer.off(Channel.sidecarRestarted, handler)
  },
  getRecentRepos: () => ipcRenderer.invoke('get-recent-repos'),
  getSidebarPrefs: () => ipcRenderer.invoke(Channel.getSidebarPrefs),
  setSidebarPrefs: (prefs: SidebarPrefs) => ipcRenderer.invoke(Channel.setSidebarPrefs, prefs),
  getRefTreeToggles: () => ipcRenderer.invoke(Channel.getRefTreeToggles),
  setRefTreeToggles: (toggles: RefTreeToggles) =>
    ipcRenderer.invoke(Channel.setRefTreeToggles, toggles),
  getPersistedTabs: () => ipcRenderer.invoke(Channel.getPersistedTabs),
  setPersistedTabs: (state: PersistedTabs) => ipcRenderer.invoke(Channel.setPersistedTabs, state),
  getWorkspaces: () => ipcRenderer.invoke('get-workspaces'),
  addWorkspace: (path: string) => ipcRenderer.invoke('add-workspace', path),
  removeWorkspace: (path: string) => ipcRenderer.invoke('remove-workspace', path),
  getActiveWorkspace: () => ipcRenderer.invoke('get-active-workspace'),
  setActiveWorkspace: (path: string | null) => ipcRenderer.invoke('set-active-workspace', path),
  getOnboardingComplete: () => ipcRenderer.invoke('get-onboarding-complete'),
  setOnboardingComplete: (complete: boolean) =>
    ipcRenderer.invoke('set-onboarding-complete', complete),
  scanForRepos: (dirPath: string) => ipcRenderer.invoke(Channel.scanForRepos, dirPath),
  sidecarRequest: (op: string, body: Record<string, unknown>) =>
    ipcRenderer.invoke(Channel.sidecarRequest, op, body)
}

contextBridge.exposeInMainWorld('electronAPI', api)

declare global {
  interface Window {
    electronAPI: IElectronAPI
  }
}

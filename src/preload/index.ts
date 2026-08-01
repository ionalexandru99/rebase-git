import { Channel } from '@shared/channels'
import type { OpenRepo, ScanForRepos } from '@shared/rpc'
import type { RpcEncodedResult } from '@shared/rpc-result'
import type { LogChunk, RepoChangedEvent } from '@shared/schemas/git'
import type {
  CancelLogStreamResponse,
  CloneProgressEvent,
  CloneRepoResponse,
  CloneRequest,
  PersistedTabs,
  PullDivergedStrategy,
  RefTreeToggles,
  SidebarPrefs,
  StartLogStreamResponse
} from '@shared/schemas/ipc'
import type { LogStreamOptions } from '@shared/schemas/log-stream'
import { contextBridge, ipcRenderer } from 'electron'

export type LogChunkEvent = LogChunk
export type { RepoChangedEvent }

type OpenRepoResponse = RpcEncodedResult<typeof OpenRepo.successSchema, typeof OpenRepo.errorSchema>
type ScanForReposResponse = RpcEncodedResult<
  typeof ScanForRepos.successSchema,
  typeof ScanForRepos.errorSchema
>

export interface IElectronAPI {
  platform: NodeJS.Platform
  selectFolder: () => Promise<string | null>
  openRepo: (path: string, owner: number) => Promise<OpenRepoResponse>
  closeRepo: (path: string, owner: number) => Promise<void>
  disownRepo: (path: string, owner: number) => Promise<void>
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
  getListPaneWidth: (repoPath: string) => Promise<number>
  setListPaneWidth: (repoPath: string, width: number) => Promise<void>
  getPullDivergedStrategy: () => Promise<PullDivergedStrategy>
  setPullDivergedStrategy: (strategy: PullDivergedStrategy) => Promise<void>
  getWorkspaces: () => Promise<string[]>
  addWorkspace: (path: string) => Promise<string[]>
  removeWorkspace: (path: string) => Promise<string[]>
  getActiveWorkspace: () => Promise<string | null>
  setActiveWorkspace: (path: string | null) => Promise<void>
  getOnboardingComplete: () => Promise<boolean>
  setOnboardingComplete: (complete: boolean) => Promise<void>
  scanForRepos: (dirPath: string) => Promise<ScanForReposResponse>
  cloneRepo: (request: CloneRequest) => Promise<CloneRepoResponse>
  cancelClone: (cloneId: number) => Promise<void>
  onCloneProgress: (cb: (event: CloneProgressEvent) => void) => () => void
  sidecarRequest: (op: string, body: Record<string, unknown>) => Promise<unknown>
}

const api: IElectronAPI = {
  platform: process.platform,
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  openRepo: (path: string, owner: number) => ipcRenderer.invoke(Channel.openRepo, path, owner),
  closeRepo: (path: string, owner: number) => ipcRenderer.invoke(Channel.closeRepo, path, owner),
  disownRepo: (path: string, owner: number) => ipcRenderer.invoke(Channel.disownRepo, path, owner),
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
  getListPaneWidth: (repoPath: string) =>
    ipcRenderer.invoke(Channel.getListPaneWidth, { repoPath }),
  setListPaneWidth: (repoPath: string, width: number) =>
    ipcRenderer.invoke(Channel.setListPaneWidth, { repoPath, width }),
  getPullDivergedStrategy: () => ipcRenderer.invoke(Channel.getPullDivergedStrategy),
  setPullDivergedStrategy: (strategy: PullDivergedStrategy) =>
    ipcRenderer.invoke(Channel.setPullDivergedStrategy, strategy),
  getWorkspaces: () => ipcRenderer.invoke('get-workspaces'),
  addWorkspace: (path: string) => ipcRenderer.invoke('add-workspace', path),
  removeWorkspace: (path: string) => ipcRenderer.invoke('remove-workspace', path),
  getActiveWorkspace: () => ipcRenderer.invoke('get-active-workspace'),
  setActiveWorkspace: (path: string | null) => ipcRenderer.invoke('set-active-workspace', path),
  getOnboardingComplete: () => ipcRenderer.invoke('get-onboarding-complete'),
  setOnboardingComplete: (complete: boolean) =>
    ipcRenderer.invoke('set-onboarding-complete', complete),
  scanForRepos: (dirPath: string) => ipcRenderer.invoke(Channel.scanForRepos, dirPath),
  cloneRepo: (request: CloneRequest) => ipcRenderer.invoke(Channel.cloneRepo, request),
  cancelClone: (cloneId: number) => ipcRenderer.invoke(Channel.cancelClone, cloneId),
  onCloneProgress: (cb: (event: CloneProgressEvent) => void) => {
    const handler = (_event: unknown, progress: CloneProgressEvent) => cb(progress)
    ipcRenderer.on(Channel.cloneProgress, handler)
    return () => ipcRenderer.off(Channel.cloneProgress, handler)
  },
  sidecarRequest: (op: string, body: Record<string, unknown>) =>
    ipcRenderer.invoke(Channel.sidecarRequest, op, body)
}

contextBridge.exposeInMainWorld('electronAPI', api)

declare global {
  interface Window {
    electronAPI: IElectronAPI
  }
}

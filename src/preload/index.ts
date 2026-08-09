import { Channel } from '@shared/channels'
import type { LogChunk, RepoChangedEvent } from '@shared/schemas/git'
import type {
  CloneProgressEvent,
  CloneRequest,
  PersistedTabs,
  PullDivergedStrategy,
  RefTreeToggles,
  RendererErrorReport,
  ReopenRepositoriesOnLaunch,
  SidebarPrefs,
  UpdateChannel,
  UpdatePreferences,
  UpdaterState
} from '@shared/schemas/ipc'
import type { LogStreamOptions } from '@shared/schemas/log-stream'
import { contextBridge, ipcRenderer } from 'electron'
import type { IElectronAPI } from '../common/desktop-api'

export type LogChunkEvent = LogChunk
export type { IElectronAPI } from '../common/desktop-api'
export type { RepoChangedEvent }

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
  getReopenRepositoriesOnLaunch: () => ipcRenderer.invoke(Channel.getReopenRepositoriesOnLaunch),
  setReopenRepositoriesOnLaunch: (reopen: ReopenRepositoriesOnLaunch) =>
    ipcRenderer.invoke(Channel.setReopenRepositoriesOnLaunch, reopen),
  getBuildInfo: () => ipcRenderer.invoke(Channel.getBuildInfo),
  revealLogsFolder: () => ipcRenderer.invoke(Channel.revealLogsFolder),
  openReleaseNotes: () => ipcRenderer.invoke(Channel.openReleaseNotes),
  getUpdaterState: () => ipcRenderer.invoke(Channel.getUpdaterState),
  onUpdaterStateChanged: (cb: (state: UpdaterState) => void) => {
    const handler = (_event: unknown, state: UpdaterState) => cb(state)
    ipcRenderer.on(Channel.updaterStateChanged, handler)
    return () => ipcRenderer.off(Channel.updaterStateChanged, handler)
  },
  checkForUpdates: () => ipcRenderer.invoke(Channel.checkForUpdates),
  downloadUpdate: () => ipcRenderer.invoke(Channel.downloadUpdate),
  installUpdate: () => ipcRenderer.invoke(Channel.installUpdate),
  getUpdatePreferences: () => ipcRenderer.invoke(Channel.getUpdatePreferences),
  setUpdatePreferences: (preferences: UpdatePreferences) =>
    ipcRenderer.invoke(Channel.setUpdatePreferences, preferences),
  getUpdateChannel: () => ipcRenderer.invoke(Channel.getUpdateChannel),
  setUpdateChannel: (channel: UpdateChannel) =>
    ipcRenderer.invoke(Channel.setUpdateChannel, channel),
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
    ipcRenderer.invoke(Channel.sidecarRequest, op, body),
  reportRendererError: (report: RendererErrorReport) =>
    ipcRenderer.invoke(Channel.reportRendererError, report)
}

contextBridge.exposeInMainWorld('electronAPI', api)

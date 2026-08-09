import type { OpenRepo, ScanForRepos } from '@shared/rpc'
import type { RpcEncodedResult } from '@shared/rpc-result'
import type { LogChunk, RepoChangedEvent } from '@shared/schemas/git'
import type {
  BuildInfo,
  CancelLogStreamResponse,
  CloneProgressEvent,
  CloneRepoResponse,
  CloneRequest,
  PersistedTabs,
  PullDivergedStrategy,
  RefTreeToggles,
  RendererErrorReport,
  ReopenRepositoriesOnLaunch,
  SidebarPrefs,
  StartLogStreamResponse,
  UpdateChannel,
  UpdatePreferences,
  UpdaterActionResult,
  UpdaterState
} from '@shared/schemas/ipc'
import type { LogStreamOptions } from '@shared/schemas/log-stream'

type OpenRepoResponse = RpcEncodedResult<typeof OpenRepo.successSchema, typeof OpenRepo.errorSchema>
type ScanForReposResponse = RpcEncodedResult<
  typeof ScanForRepos.successSchema,
  typeof ScanForRepos.errorSchema
>

export type DesktopPlatform =
  | 'aix'
  | 'android'
  | 'cygwin'
  | 'darwin'
  | 'freebsd'
  | 'haiku'
  | 'linux'
  | 'netbsd'
  | 'openbsd'
  | 'sunos'
  | 'win32'

export interface IElectronAPI {
  platform: DesktopPlatform
  selectFolder: () => Promise<string | null>
  openRepo: (path: string, owner: number) => Promise<OpenRepoResponse>
  closeRepo: (path: string, owner: number) => Promise<void>
  disownRepo: (path: string, owner: number) => Promise<void>
  startLogStream: (repoPath: string, options?: LogStreamOptions) => Promise<StartLogStreamResponse>
  cancelLogStream: (repoPath?: string) => Promise<CancelLogStreamResponse>
  onLogChunk: (callback: (chunk: LogChunk) => void) => () => void
  onRepoChanged: (callback: (event: RepoChangedEvent) => void) => () => void
  onSidecarRestarted: (callback: () => void) => () => void
  getRecentRepos: () => Promise<string[]>
  getSidebarPrefs: () => Promise<SidebarPrefs>
  setSidebarPrefs: (preferences: SidebarPrefs) => Promise<void>
  getRefTreeToggles: () => Promise<RefTreeToggles>
  setRefTreeToggles: (toggles: RefTreeToggles) => Promise<void>
  getPersistedTabs: () => Promise<PersistedTabs>
  setPersistedTabs: (state: PersistedTabs) => Promise<void>
  getListPaneWidth: (repoPath: string) => Promise<number>
  setListPaneWidth: (repoPath: string, width: number) => Promise<void>
  getPullDivergedStrategy: () => Promise<PullDivergedStrategy>
  setPullDivergedStrategy: (strategy: PullDivergedStrategy) => Promise<void>
  getReopenRepositoriesOnLaunch: () => Promise<ReopenRepositoriesOnLaunch>
  setReopenRepositoriesOnLaunch: (reopen: ReopenRepositoriesOnLaunch) => Promise<void>
  getBuildInfo: () => Promise<BuildInfo>
  revealLogsFolder: () => Promise<void>
  openReleaseNotes: () => Promise<void>
  getUpdaterState: () => Promise<UpdaterState>
  onUpdaterStateChanged: (callback: (state: UpdaterState) => void) => () => void
  checkForUpdates: () => Promise<UpdaterActionResult>
  downloadUpdate: () => Promise<UpdaterActionResult>
  installUpdate: () => Promise<UpdaterActionResult>
  getUpdatePreferences: () => Promise<UpdatePreferences>
  setUpdatePreferences: (preferences: UpdatePreferences) => Promise<void>
  getUpdateChannel: () => Promise<UpdateChannel>
  setUpdateChannel: (channel: UpdateChannel) => Promise<UpdaterActionResult>
  getWorkspaces: () => Promise<string[]>
  addWorkspace: (path: string) => Promise<string[]>
  removeWorkspace: (path: string) => Promise<string[]>
  getActiveWorkspace: () => Promise<string | null>
  setActiveWorkspace: (path: string | null) => Promise<void>
  getOnboardingComplete: () => Promise<boolean>
  setOnboardingComplete: (complete: boolean) => Promise<void>
  scanForRepos: (directoryPath: string) => Promise<ScanForReposResponse>
  cloneRepo: (request: CloneRequest) => Promise<CloneRepoResponse>
  cancelClone: (cloneId: number) => Promise<void>
  onCloneProgress: (callback: (event: CloneProgressEvent) => void) => () => void
  sidecarRequest: (operation: string, body: Record<string, unknown>) => Promise<unknown>
  reportRendererError: (report: RendererErrorReport) => Promise<void>
}

declare global {
  interface Window {
    electronAPI: IElectronAPI
  }
}

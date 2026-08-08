import '@testing-library/jest-dom/vitest'
import { LIST_PANE_DEFAULT_WIDTH } from '@shared/list-layout'
import {
  Checkout,
  Commit,
  DiscardHunk,
  Fetch,
  GetCommitDetail,
  GetCommitStats,
  GetDiff,
  GetIdentity,
  GetLocalBranches,
  GetRemoteRefs,
  GetStatus,
  GetWorkingTreeStats,
  type HunkLineSelection,
  Pull,
  type PullStrategy,
  Push,
  StageFile,
  StageHunk,
  StageLines,
  StashList,
  UnstageFile,
  UnstageHunk,
  UnstageLines
} from '@shared/rpc'
import type { GitBranches } from '@shared/schemas/git'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import { installBrowserTestEnvironment, resizeObserverMock } from './browser-environment'
import { createSidecarRpcFake, type RpcWireResult } from './sidecar-rpc-fake'

export {
  type LogStreamHandle,
  type RepoChangedHandle,
  setupLogStream,
  setupRepoChanged
} from './electron-event-fakes'
export { resizeObserverMock }

type StatusResponse = RpcWireResult<typeof GetStatus>
type LocalBranchesResponse = RpcWireResult<typeof GetLocalBranches>
type RemoteRefsResponse = RpcWireResult<typeof GetRemoteRefs>
type StageResponse = RpcWireResult<typeof StageFile>
type GuardedWriteResponse = RpcWireResult<typeof UnstageFile>
type CommitResponse = RpcWireResult<typeof Commit>
type GetDiffResponse = RpcWireResult<typeof GetDiff>
type CommitDetailResponse = RpcWireResult<typeof GetCommitDetail>
type CommitStatsResponse = RpcWireResult<typeof GetCommitStats>
type WorkingTreeStatsResponse = RpcWireResult<typeof GetWorkingTreeStats>
type StageHunkResponse = RpcWireResult<typeof StageHunk>
type GuardedHunkResponse = RpcWireResult<typeof UnstageHunk>
type StashListResponse = RpcWireResult<typeof StashList>
type IdentityResponse = RpcWireResult<typeof GetIdentity>
type PullWire = RpcWireResult<typeof Pull>
type FetchWire = RpcWireResult<typeof Fetch>
type PushWire = RpcWireResult<typeof Push>

const KNOWN_IDENTITY = { name: 'Test', email: 'test@example.com' }

const sidecarRpcFake = createSidecarRpcFake()

export const sidecarMock = {
  respond: sidecarRpcFake.respond,
  getStatus: vi.fn<(repoPath: string) => Promise<StatusResponse>>(),
  getLocalBranches: vi.fn<(repoPath: string) => Promise<LocalBranchesResponse>>(),
  getRemoteRefs: vi.fn<(repoPath: string) => Promise<RemoteRefsResponse>>(),
  stageFile: vi.fn<(repoPath: string, file: string) => Promise<StageResponse>>(),
  unstageFile:
    vi.fn<
      (repoPath: string, file: string, renameSource?: string) => Promise<GuardedWriteResponse>
    >(),
  commit: vi.fn<(repoPath: string, message: string) => Promise<CommitResponse>>(),
  fetchRepo: vi.fn<(repoPath: string) => Promise<FetchWire>>(),
  pushRepo: vi.fn<(repoPath: string) => Promise<PushWire>>(),
  pullRepo: vi.fn<(repoPath: string, strategy?: PullStrategy) => Promise<PullWire>>(),
  getDiff:
    vi.fn<
      (
        repoPath: string,
        file: string,
        staged: boolean,
        scope?: { range?: string; commit?: string; renameSource?: string }
      ) => Promise<GetDiffResponse>
    >(),
  getCommitDetail: vi.fn<(repoPath: string, sha: string) => Promise<CommitDetailResponse>>(),
  getCommitStats:
    vi.fn<(repoPath: string, shas: readonly string[]) => Promise<CommitStatsResponse>>(),
  getWorkingTreeStats: vi.fn<(repoPath: string) => Promise<WorkingTreeStatsResponse>>(),
  stageHunk:
    vi.fn<(repoPath: string, file: string, hunkHeader: string) => Promise<StageHunkResponse>>(),
  unstageHunk:
    vi.fn<(repoPath: string, file: string, hunkHeader: string) => Promise<GuardedHunkResponse>>(),
  discardHunk:
    vi.fn<(repoPath: string, file: string, hunkHeader: string) => Promise<GuardedHunkResponse>>(),
  stageLines:
    vi.fn<
      (
        repoPath: string,
        file: string,
        selections: readonly HunkLineSelection[]
      ) => Promise<StageHunkResponse>
    >(),
  unstageLines:
    vi.fn<
      (
        repoPath: string,
        file: string,
        selections: readonly HunkLineSelection[]
      ) => Promise<GuardedHunkResponse>
    >(),
  stashList: vi.fn<(repoPath: string) => Promise<StashListResponse>>(),
  getIdentity: vi.fn<() => Promise<IdentityResponse>>(),
  checkout:
    vi.fn<
      (
        repoPath: string,
        refKind: string,
        fullPath: string
      ) => Promise<RpcWireResult<typeof Checkout>>
    >()
}
;(globalThis as Record<string, unknown>).__sidecarMock = sidecarMock

installBrowserTestEnvironment()

const mockElectronAPI = {
  platform: 'darwin' as NodeJS.Platform,
  selectFolder: vi.fn(),
  openRepo: vi.fn(),
  closeRepo: vi.fn(),
  disownRepo: vi.fn(),
  startLogStream: vi.fn(),
  cancelLogStream: vi.fn(),
  onLogChunk: vi.fn(),
  onRepoChanged: vi.fn(),
  onSidecarRestarted: vi.fn(),
  getRecentRepos: vi.fn(),
  getSidebarPrefs: vi.fn(),
  setSidebarPrefs: vi.fn(),
  getRefTreeToggles: vi.fn(),
  setRefTreeToggles: vi.fn(),
  getPersistedTabs: vi.fn(),
  setPersistedTabs: vi.fn(),
  getListPaneWidth: vi.fn(),
  setListPaneWidth: vi.fn(),
  getPullDivergedStrategy: vi.fn(),
  setPullDivergedStrategy: vi.fn(),
  getReopenRepositoriesOnLaunch: vi.fn(),
  setReopenRepositoriesOnLaunch: vi.fn(),
  getBuildInfo: vi.fn(),
  revealLogsFolder: vi.fn(),
  openReleaseNotes: vi.fn(),
  getUpdaterState: vi.fn(),
  onUpdaterStateChanged: vi.fn(),
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  installUpdate: vi.fn(),
  getUpdatePreferences: vi.fn(),
  setUpdatePreferences: vi.fn(),
  getUpdateChannel: vi.fn(),
  setUpdateChannel: vi.fn(),
  getWorkspaces: vi.fn(),
  addWorkspace: vi.fn(),
  removeWorkspace: vi.fn(),
  getActiveWorkspace: vi.fn(),
  setActiveWorkspace: vi.fn(),
  getOnboardingComplete: vi.fn(),
  setOnboardingComplete: vi.fn(),
  scanForRepos: vi.fn(),
  cloneRepo: vi.fn(),
  cancelClone: vi.fn(),
  onCloneProgress: vi.fn(),
  sidecarRequest: vi.fn(),
  reportRendererError: vi.fn()
}

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true
})

export function mockBranchResponses(
  branches: Pick<GitBranches, 'current' | 'all'> &
    Partial<Pick<GitBranches, 'remotes' | 'tags' | 'tracking'>>
): void {
  const remotes = branches.remotes ?? []
  const tags = branches.tags ?? []
  vi.mocked(sidecarMock.getLocalBranches).mockResolvedValue({
    _tag: 'Ok',
    branches: {
      current: branches.current,
      all: branches.all,
      tracking: branches.tracking
    }
  })
  vi.mocked(sidecarMock.getRemoteRefs).mockResolvedValue({
    _tag: 'Ok',
    refs: { remotes, tags }
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  sidecarRpcFake.reset()
  resizeObserverMock.reset()
  vi.mocked(window.electronAPI.getSidebarPrefs).mockResolvedValue({ open: true, width: 256 })
  vi.mocked(window.electronAPI.getRefTreeToggles).mockResolvedValue([])
  vi.mocked(window.electronAPI.getPersistedTabs).mockResolvedValue({
    tabs: [null],
    activeIndex: 0
  })
  vi.mocked(window.electronAPI.setPersistedTabs).mockResolvedValue(undefined)
  vi.mocked(window.electronAPI.getListPaneWidth).mockResolvedValue(LIST_PANE_DEFAULT_WIDTH)
  vi.mocked(window.electronAPI.setListPaneWidth).mockResolvedValue(undefined)
  vi.mocked(window.electronAPI.getPullDivergedStrategy).mockResolvedValue(null)
  vi.mocked(window.electronAPI.setPullDivergedStrategy).mockResolvedValue(undefined)
  vi.mocked(window.electronAPI.getReopenRepositoriesOnLaunch).mockResolvedValue(true)
  vi.mocked(window.electronAPI.setReopenRepositoriesOnLaunch).mockResolvedValue(undefined)
  vi.mocked(window.electronAPI.getBuildInfo).mockResolvedValue({
    version: '1.0.0',
    commitSha: 'abcdef1234567890abcdef1234567890abcdef12',
    electronVersion: '37.2.0',
    platformArch: 'darwin-arm64'
  })
  vi.mocked(window.electronAPI.revealLogsFolder).mockResolvedValue(undefined)
  vi.mocked(window.electronAPI.openReleaseNotes).mockResolvedValue(undefined)
  vi.mocked(window.electronAPI.getUpdaterState).mockResolvedValue({
    status: 'idle',
    supported: true,
    unsupportedReason: null,
    currentVersion: '1.0.0',
    availableVersion: null,
    downloadPercent: null,
    lastCheckedAt: null,
    errorMessage: null
  })
  vi.mocked(window.electronAPI.onUpdaterStateChanged).mockReturnValue(() => {})
  vi.mocked(window.electronAPI.checkForUpdates).mockResolvedValue({ _tag: 'Started' })
  vi.mocked(window.electronAPI.downloadUpdate).mockResolvedValue({ _tag: 'Started' })
  vi.mocked(window.electronAPI.installUpdate).mockResolvedValue({ _tag: 'Started' })
  vi.mocked(window.electronAPI.getUpdatePreferences).mockResolvedValue({
    downloadInBackground: true,
    installOnQuit: true
  })
  vi.mocked(window.electronAPI.setUpdatePreferences).mockResolvedValue(undefined)
  vi.mocked(window.electronAPI.getUpdateChannel).mockResolvedValue('stable')
  vi.mocked(window.electronAPI.setUpdateChannel).mockResolvedValue({ _tag: 'Started' })
  vi.mocked(window.electronAPI.reportRendererError).mockResolvedValue(undefined)
  sidecarRpcFake.respond(Commit, ({ repoPath, message }) => sidecarMock.commit(repoPath, message))
  sidecarRpcFake.respond(GetStatus, ({ repoPath }) => sidecarMock.getStatus(repoPath))
  sidecarRpcFake.respond(GetLocalBranches, ({ repoPath }) => sidecarMock.getLocalBranches(repoPath))
  sidecarRpcFake.respond(GetRemoteRefs, ({ repoPath }) => sidecarMock.getRemoteRefs(repoPath))
  sidecarRpcFake.respond(GetDiff, ({ repoPath, file, staged, range, commit, renameSource }) =>
    sidecarMock.getDiff(repoPath, file, staged === true, { range, commit, renameSource })
  )
  sidecarRpcFake.respond(GetCommitDetail, ({ repoPath, sha }) =>
    sidecarMock.getCommitDetail(repoPath, sha)
  )
  sidecarRpcFake.respond(GetCommitStats, ({ repoPath, shas }) =>
    sidecarMock.getCommitStats(repoPath, shas)
  )
  sidecarRpcFake.respond(GetWorkingTreeStats, ({ repoPath }) =>
    sidecarMock.getWorkingTreeStats(repoPath)
  )
  sidecarRpcFake.respond(StashList, ({ repoPath }) => sidecarMock.stashList(repoPath))
  sidecarRpcFake.respond(StageFile, ({ repoPath, file }) => sidecarMock.stageFile(repoPath, file))
  sidecarRpcFake.respond(UnstageFile, ({ repoPath, file, renameSource }) =>
    renameSource === undefined
      ? sidecarMock.unstageFile(repoPath, file)
      : sidecarMock.unstageFile(repoPath, file, renameSource)
  )
  sidecarRpcFake.respond(StageHunk, ({ repoPath, file, hunkHeader }) =>
    sidecarMock.stageHunk(repoPath, file, hunkHeader)
  )
  sidecarRpcFake.respond(UnstageHunk, ({ repoPath, file, hunkHeader }) =>
    sidecarMock.unstageHunk(repoPath, file, hunkHeader)
  )
  sidecarRpcFake.respond(DiscardHunk, ({ repoPath, file, hunkHeader }) =>
    sidecarMock.discardHunk(repoPath, file, hunkHeader)
  )
  sidecarRpcFake.respond(StageLines, ({ repoPath, file, selections }) =>
    sidecarMock.stageLines(repoPath, file, selections)
  )
  sidecarRpcFake.respond(UnstageLines, ({ repoPath, file, selections }) =>
    sidecarMock.unstageLines(repoPath, file, selections)
  )
  sidecarRpcFake.respond(Checkout, ({ repoPath, refKind, fullPath }) =>
    sidecarMock.checkout(repoPath, refKind, fullPath)
  )
  sidecarRpcFake.respond(GetIdentity, () => sidecarMock.getIdentity())
  sidecarRpcFake.respond(Fetch, ({ repoPath }) => sidecarMock.fetchRepo(repoPath))
  sidecarRpcFake.respond(Push, ({ repoPath }) => sidecarMock.pushRepo(repoPath))
  sidecarRpcFake.respond(Pull, ({ repoPath, strategy }) => {
    if (strategy === undefined) {
      return sidecarMock.pullRepo(repoPath)
    }
    if (strategy === 'rebase' || strategy === 'merge') {
      return sidecarMock.pullRepo(repoPath, strategy)
    }
    throw new Error(`Unexpected pull strategy '${strategy}'`)
  })
  vi.mocked(window.electronAPI.sidecarRequest).mockImplementation(sidecarRpcFake.request)
  vi.mocked(window.electronAPI.closeRepo).mockResolvedValue(undefined)
  vi.mocked(window.electronAPI.disownRepo).mockResolvedValue(undefined)
  sidecarMock.stashList.mockResolvedValue({ _tag: 'Ok', stashes: [] })
  sidecarMock.getIdentity.mockResolvedValue({
    _tag: 'Ok',
    local: {},
    global: KNOWN_IDENTITY,
    effective: KNOWN_IDENTITY
  })
  sidecarMock.getCommitStats.mockResolvedValue({ _tag: 'Ok', stats: [] })
  sidecarMock.getWorkingTreeStats.mockResolvedValue({ _tag: 'Ok', additions: 0, deletions: 0 })
  sidecarMock.checkout.mockResolvedValue({ _tag: 'Ok', checkedOut: 'main' })
  sidecarMock.fetchRepo.mockResolvedValue({ _tag: 'Ok' })
  sidecarMock.pushRepo.mockResolvedValue({ _tag: 'Ok' })
  sidecarMock.pullRepo.mockResolvedValue({ _tag: 'Ok' })
  mockBranchResponses({ current: '', all: [], remotes: [], tags: [] })
})

afterEach(() => {
  cleanup()
})

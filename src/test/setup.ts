import '@testing-library/jest-dom/vitest'
import { LIST_PANE_DEFAULT_WIDTH } from '@shared/list-layout'
import type {
  Commit,
  Fetch,
  GetCommitDetail,
  GetCommitStats,
  GetDiff,
  GetLocalBranches,
  GetRemoteRefs,
  GetStatus,
  GetWorkingTreeStats,
  HunkLineSelection,
  Pull,
  PullStrategy,
  StageFile,
  StageHunk,
  StashList,
  UnstageHunk
} from '@shared/rpc'
import type { RpcEncodedResult } from '@shared/rpc-result'
import type { GitBranches } from '@shared/schemas/git'
import { act, cleanup } from '@testing-library/react'
import { Storage } from 'happy-dom'
import { afterEach, beforeEach, vi } from 'vitest'

type StatusResponse = RpcEncodedResult<typeof GetStatus.successSchema, typeof GetStatus.errorSchema>
type LocalBranchesResponse = RpcEncodedResult<
  typeof GetLocalBranches.successSchema,
  typeof GetLocalBranches.errorSchema
>
type RemoteRefsResponse = RpcEncodedResult<
  typeof GetRemoteRefs.successSchema,
  typeof GetRemoteRefs.errorSchema
>
type StageResponse = RpcEncodedResult<typeof StageFile.successSchema, typeof StageFile.errorSchema>
type CommitResponse = RpcEncodedResult<typeof Commit.successSchema, typeof Commit.errorSchema>
type GetDiffResponse = RpcEncodedResult<typeof GetDiff.successSchema, typeof GetDiff.errorSchema>
type CommitDetailResponse = RpcEncodedResult<
  typeof GetCommitDetail.successSchema,
  typeof GetCommitDetail.errorSchema
>
type CommitStatsResponse = RpcEncodedResult<
  typeof GetCommitStats.successSchema,
  typeof GetCommitStats.errorSchema
>
type WorkingTreeStatsResponse = RpcEncodedResult<
  typeof GetWorkingTreeStats.successSchema,
  typeof GetWorkingTreeStats.errorSchema
>
type StageHunkResponse = RpcEncodedResult<
  typeof StageHunk.successSchema,
  typeof StageHunk.errorSchema
>
type GuardedHunkResponse = RpcEncodedResult<
  typeof UnstageHunk.successSchema,
  typeof UnstageHunk.errorSchema
>
type StashListResponse = RpcEncodedResult<
  typeof StashList.successSchema,
  typeof StashList.errorSchema
>
type VoidWriteWire = StageResponse
type PullWire = RpcEncodedResult<typeof Pull.successSchema, typeof Pull.errorSchema>
type FetchWire = RpcEncodedResult<typeof Fetch.successSchema, typeof Fetch.errorSchema>

const opHandlers = new Map<string, (body: Record<string, unknown>) => unknown | Promise<unknown>>()

export const sidecarMock = {
  respond(op: string, handler: (body: Record<string, unknown>) => unknown): void {
    opHandlers.set(op, handler)
  },
  getStatus: vi.fn<(repoPath: string) => Promise<StatusResponse>>(),
  getLocalBranches: vi.fn<(repoPath: string) => Promise<LocalBranchesResponse>>(),
  getRemoteRefs: vi.fn<(repoPath: string) => Promise<RemoteRefsResponse>>(),
  stageFile: vi.fn<(repoPath: string, file: string) => Promise<StageResponse>>(),
  unstageFile:
    vi.fn<(repoPath: string, file: string, renameSource?: string) => Promise<StageResponse>>(),
  commit: vi.fn<(repoPath: string, message: string) => Promise<CommitResponse>>(),
  fetchRepo: vi.fn<(repoPath: string) => Promise<FetchWire>>(),
  pushRepo: vi.fn<(repoPath: string) => Promise<VoidWriteWire>>(),
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
  checkout:
    vi.fn<(repoPath: string, refKind: string, fullPath: string) => Promise<CheckoutResult>>()
}

type CheckoutResult =
  | { _tag: 'Ok'; checkedOut: string }
  | { _tag: 'RepoNotOpen' }
  | { _tag: 'GitError'; message: string }
;(globalThis as Record<string, unknown>).__sidecarMock = sidecarMock

const localStorageMock = new Storage()
const sessionStorageMock = new Storage()
for (const storageTarget of [globalThis, window]) {
  Object.defineProperties(storageTarget, {
    localStorage: {
      configurable: true,
      value: localStorageMock
    },
    sessionStorage: {
      configurable: true,
      value: sessionStorageMock
    }
  })
}

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false
  })
})

const DEFAULT_OBSERVED_RECT = { height: 800, width: 400 }
let observedRect = { ...DEFAULT_OBSERVED_RECT }
const liveResizeObservers = new Set<ResizeObserverMock>()

class ResizeObserverMock {
  private callback: ResizeObserverCallback
  private targets = new Set<Element>()

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    liveResizeObservers.add(this)
  }

  emit(): void {
    for (const target of this.targets) {
      this.callback(
        [{ target, contentRect: { ...observedRect } as DOMRectReadOnly } as ResizeObserverEntry],
        this as unknown as ResizeObserver
      )
    }
  }

  observe = vi.fn((element: Element) => {
    this.targets.add(element)
    this.callback(
      [
        {
          target: element,
          contentRect: { ...observedRect } as DOMRectReadOnly
        } as ResizeObserverEntry
      ],
      this as unknown as ResizeObserver
    )
  })
  unobserve = vi.fn((element: Element) => {
    this.targets.delete(element)
  })
  disconnect = vi.fn(() => {
    this.targets.clear()
    liveResizeObservers.delete(this)
  })
}

export const resizeObserverMock = {
  setContentRect(rect: Partial<{ width: number; height: number }>): void {
    observedRect = { ...observedRect, ...rect }
    act(() => {
      for (const observer of [...liveResizeObservers]) {
        observer.emit()
      }
    })
  }
}
Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: ResizeObserverMock
})

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
  sidecarRequest: vi.fn()
}

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true
})

export interface LogStreamHandle {
  fire: (chunk: {
    repoPath: string
    commits: Array<{
      hash: string
      message: string
      author_name: string
      date: string
      parents: string[]
      refs: string
    }>
    done?: boolean
    hasMore?: boolean
    error?: string
    streamId?: number
  }) => void
  fireDone: (repoPath: string, hasMore?: boolean) => void
}

export function setupLogStream(): LogStreamHandle {
  const listeners: Array<(chunk: unknown) => void> = []
  vi.mocked(window.electronAPI.onLogChunk).mockImplementation((cb) => {
    listeners.push(cb as (chunk: unknown) => void)
    return () => {
      const index = listeners.indexOf(cb as (chunk: unknown) => void)
      if (index !== -1) {
        listeners.splice(index, 1)
      }
    }
  })
  vi.mocked(window.electronAPI.startLogStream).mockResolvedValue({ _tag: 'Ok' })
  vi.mocked(window.electronAPI.cancelLogStream).mockResolvedValue({})
  return {
    fire: (chunk) => {
      act(() => {
        for (const callback of listeners.slice()) {
          callback({ done: false, ...chunk })
        }
      })
    },
    fireDone: (repoPath, hasMore) => {
      act(() => {
        for (const callback of listeners.slice()) {
          callback({ repoPath, commits: [], done: true, hasMore })
        }
      })
    }
  }
}

export interface RepoChangedHandle {
  fire: (evt: { repoPath: string; kind: 'refs' | 'workingTree' | 'index' }) => void
}

export function setupRepoChanged(): RepoChangedHandle {
  const listeners: Array<(evt: unknown) => void> = []
  vi.mocked(window.electronAPI.onRepoChanged).mockImplementation((cb) => {
    listeners.push(cb as (evt: unknown) => void)
    return () => {
      const index = listeners.indexOf(cb as (evt: unknown) => void)
      if (index !== -1) {
        listeners.splice(index, 1)
      }
    }
  })
  return {
    fire: (evt) => {
      act(() => {
        for (const callback of listeners.slice()) {
          callback(evt)
        }
      })
    }
  }
}

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
  opHandlers.clear()
  observedRect = { ...DEFAULT_OBSERVED_RECT }
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
  vi.mocked(window.electronAPI.sidecarRequest).mockImplementation(async (op, body) => {
    const repoPath = body.repoPath as string
    switch (op) {
      case 'commit':
        return sidecarMock.commit(repoPath, body.message as string)
      case 'getStatus':
        return sidecarMock.getStatus(repoPath)
      case 'getLocalBranches':
        return sidecarMock.getLocalBranches(repoPath)
      case 'getRemoteRefs':
        return sidecarMock.getRemoteRefs(repoPath)
      case 'getDiff':
        return sidecarMock.getDiff(repoPath, body.file as string, body.staged === true, {
          range: body.range as string | undefined,
          commit: body.commit as string | undefined,
          renameSource: body.renameSource as string | undefined
        })
      case 'getCommitDetail':
        return sidecarMock.getCommitDetail(repoPath, body.sha as string)
      case 'getCommitStats':
        return sidecarMock.getCommitStats(repoPath, body.shas as readonly string[])
      case 'getWorkingTreeStats':
        return sidecarMock.getWorkingTreeStats(repoPath)
      case 'stashList':
        return sidecarMock.stashList(repoPath)
      case 'stageFile':
        return sidecarMock.stageFile(repoPath, body.file as string)
      case 'unstageFile':
        return typeof body.renameSource === 'string'
          ? sidecarMock.unstageFile(repoPath, body.file as string, body.renameSource)
          : sidecarMock.unstageFile(repoPath, body.file as string)
      case 'stageHunk':
        return sidecarMock.stageHunk(repoPath, body.file as string, body.hunkHeader as string)
      case 'unstageHunk':
        return sidecarMock.unstageHunk(repoPath, body.file as string, body.hunkHeader as string)
      case 'discardHunk':
        return sidecarMock.discardHunk(repoPath, body.file as string, body.hunkHeader as string)
      case 'stageLines':
        return sidecarMock.stageLines(
          repoPath,
          body.file as string,
          body.selections as HunkLineSelection[]
        )
      case 'unstageLines':
        return sidecarMock.unstageLines(
          repoPath,
          body.file as string,
          body.selections as HunkLineSelection[]
        )
      case 'checkout':
        return sidecarMock.checkout(repoPath, body.refKind as string, body.fullPath as string)
      case 'fetch':
        return sidecarMock.fetchRepo(repoPath)
      case 'push':
        return sidecarMock.pushRepo(repoPath)
      case 'pull': {
        if (body.strategy === undefined) {
          return sidecarMock.pullRepo(repoPath)
        }
        if (body.strategy !== 'rebase' && body.strategy !== 'merge') {
          throw new Error(`invalid pull strategy: ${String(body.strategy)}`)
        }
        return sidecarMock.pullRepo(repoPath, body.strategy)
      }
      default: {
        const handler = opHandlers.get(op)
        if (handler) {
          return handler(body)
        }
        return { _tag: 'Ok' }
      }
    }
  })
  vi.mocked(window.electronAPI.closeRepo).mockResolvedValue(undefined)
  vi.mocked(window.electronAPI.disownRepo).mockResolvedValue(undefined)
  sidecarMock.stashList.mockResolvedValue({ _tag: 'Ok', stashes: [] })
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

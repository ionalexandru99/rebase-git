import '@testing-library/jest-dom/vitest'
import type {
  Commit,
  Fetch,
  GetDiff,
  GetLocalBranches,
  GetRemoteRefs,
  GetStatus,
  StageFile,
  StageHunk,
  StashList
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
type StageHunkResponse = RpcEncodedResult<
  typeof StageHunk.successSchema,
  typeof StageHunk.errorSchema
>
type StashListResponse = RpcEncodedResult<
  typeof StashList.successSchema,
  typeof StashList.errorSchema
>
type VoidWriteWire = StageResponse
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
  pullRepo: vi.fn<(repoPath: string) => Promise<VoidWriteWire>>(),
  getDiff: vi.fn<(repoPath: string, file: string, staged: boolean) => Promise<GetDiffResponse>>(),
  stageHunk:
    vi.fn<(repoPath: string, file: string, hunkHeader: string) => Promise<StageHunkResponse>>(),
  unstageHunk:
    vi.fn<(repoPath: string, file: string, hunkHeader: string) => Promise<StageHunkResponse>>(),
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

class ResizeObserverMock {
  private callback: ResizeObserverCallback

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
  }

  observe = vi.fn((element: Element) => {
    this.callback(
      [
        {
          target: element,
          contentRect: { height: 800, width: 400 } as DOMRectReadOnly
        } as ResizeObserverEntry
      ],
      this as unknown as ResizeObserver
    )
  })
  unobserve = vi.fn()
  disconnect = vi.fn()
}
Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: ResizeObserverMock
})

const mockElectronAPI = {
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
  getWorkspaces: vi.fn(),
  addWorkspace: vi.fn(),
  removeWorkspace: vi.fn(),
  getActiveWorkspace: vi.fn(),
  setActiveWorkspace: vi.fn(),
  getOnboardingComplete: vi.fn(),
  setOnboardingComplete: vi.fn(),
  scanForRepos: vi.fn(),
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
  vi.mocked(window.electronAPI.getSidebarPrefs).mockResolvedValue({ open: true, width: 256 })
  vi.mocked(window.electronAPI.getRefTreeToggles).mockResolvedValue([])
  vi.mocked(window.electronAPI.getPersistedTabs).mockResolvedValue({
    tabs: [null],
    activeIndex: 0
  })
  vi.mocked(window.electronAPI.setPersistedTabs).mockResolvedValue(undefined)
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
        return sidecarMock.getDiff(repoPath, body.file as string, body.staged === true)
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
      case 'checkout':
        return sidecarMock.checkout(repoPath, body.refKind as string, body.fullPath as string)
      case 'fetch':
        return sidecarMock.fetchRepo(repoPath)
      case 'push':
        return sidecarMock.pushRepo(repoPath)
      case 'pull':
        return sidecarMock.pullRepo(repoPath)
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
  sidecarMock.checkout.mockResolvedValue({ _tag: 'Ok', checkedOut: 'main' })
  sidecarMock.fetchRepo.mockResolvedValue({ _tag: 'Ok' })
  sidecarMock.pushRepo.mockResolvedValue({ _tag: 'Ok' })
  sidecarMock.pullRepo.mockResolvedValue({ _tag: 'Ok' })
  mockBranchResponses({ current: '', all: [], remotes: [], tags: [] })
})

afterEach(() => {
  cleanup()
})

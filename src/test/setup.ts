import '@testing-library/jest-dom/vitest'
import { parseOrThrow } from '@shared/codec'
import type { GitBranches } from '@shared/schemas/git'
import type {
  BranchesResponse,
  CommitResponse,
  FetchResponse,
  GetDiffResponse,
  LocalBranchesResponse,
  LogResponse,
  PullResponse,
  PushResponse,
  RemoteRefsResponse,
  StageHunkResponse,
  StageResponse,
  StashListResponse,
  StatusResponse,
  UnstageResponse
} from '@shared/schemas/ipc'
import { cleanup } from '@testing-library/react'
import type { Schema } from 'effect'
import { afterEach, beforeEach, vi } from 'vitest'
import { clearAllSnapshots } from '@/lib/repo-snapshot-cache'

const opHandlers = new Map<string, (body: Record<string, unknown>) => unknown | Promise<unknown>>()

export const sidecarMock = {
  respond(op: string, handler: (body: Record<string, unknown>) => unknown): void {
    opHandlers.set(op, handler)
  },
  getStatus: vi.fn<(repoPath: string) => Promise<StatusResponse>>(),
  getBranches: vi.fn<(repoPath: string) => Promise<BranchesResponse>>(),
  getLocalBranches: vi.fn<(repoPath: string) => Promise<LocalBranchesResponse>>(),
  getRemoteRefs: vi.fn<(repoPath: string) => Promise<RemoteRefsResponse>>(),
  getLog: vi.fn<(repoPath: string) => Promise<LogResponse>>(),
  stageFile: vi.fn<(repoPath: string, file: string) => Promise<StageResponse>>(),
  unstageFile: vi.fn<(repoPath: string, file: string) => Promise<UnstageResponse>>(),
  commit: vi.fn<(repoPath: string, message: string) => Promise<CommitResponse>>(),
  fetchRepo: vi.fn<(repoPath: string) => Promise<FetchResponse>>(),
  pushRepo: vi.fn<(repoPath: string) => Promise<PushResponse>>(),
  pullRepo: vi.fn<(repoPath: string) => Promise<PullResponse>>(),
  getDiff: vi.fn<(repoPath: string, file: string, staged: boolean) => Promise<GetDiffResponse>>(),
  stageHunk:
    vi.fn<(repoPath: string, file: string, hunkHeader: string) => Promise<StageHunkResponse>>(),
  unstageHunk:
    vi.fn<(repoPath: string, file: string, hunkHeader: string) => Promise<StageHunkResponse>>(),
  stashList: vi.fn<(repoPath: string) => Promise<StashListResponse>>()
}
;(globalThis as Record<string, unknown>).__sidecarMock = sidecarMock

vi.mock('@/lib/sidecar-fetch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sidecar-fetch')>()

  return {
    ...actual,
    sidecarFetch: vi.fn(
      async (
        op: string,
        body: Record<string, unknown>,
        schema: Schema.Schema<unknown, unknown>
      ) => {
        const mock = (globalThis as Record<string, unknown>).__sidecarMock as typeof sidecarMock
        const repoPath = body.repoPath as string
        let payload: unknown
        switch (op) {
          case 'get-status':
            payload = await mock.getStatus(repoPath)
            break
          case 'get-branches':
            payload = await mock.getBranches(repoPath)
            break
          case 'get-local-branches':
            payload = await mock.getLocalBranches(repoPath)
            break
          case 'get-remote-refs':
            payload = await mock.getRemoteRefs(repoPath)
            break
          case 'get-log':
            payload = await mock.getLog(repoPath)
            break
          case 'stage-file':
            payload = await mock.stageFile(repoPath, body.file as string)
            break
          case 'unstage-file':
            payload = await mock.unstageFile(repoPath, body.file as string)
            break
          case 'commit':
            payload = await mock.commit(repoPath, body.message as string)
            break
          case 'fetch-repo':
            payload = await mock.fetchRepo(repoPath)
            break
          case 'push-repo':
            payload = await mock.pushRepo(repoPath)
            break
          case 'pull-repo':
            payload = await mock.pullRepo(repoPath)
            break
          case 'get-diff':
            payload = await mock.getDiff(repoPath, body.file as string, body.staged === true)
            break
          case 'stage-hunk':
            payload = await mock.stageHunk(repoPath, body.file as string, body.hunkHeader as string)
            break
          case 'unstage-hunk':
            payload = await mock.unstageHunk(
              repoPath,
              body.file as string,
              body.hunkHeader as string
            )
            break
          case 'stash-list':
            payload = await mock.stashList(repoPath)
            break
          default: {
            const handler = opHandlers.get(op)
            if (!handler) {
              throw new Error(
                `Unregistered sidecar op in test: "${op}". Register it with ` +
                  `sidecarMock.respond('${op}', ...) or add a case in src/test/setup.ts.`
              )
            }
            payload = await handler(body)
            break
          }
        }
        return parseOrThrow(schema, payload)
      }
    )
  }
})

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
  checkoutRef: vi.fn(),
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
      for (const callback of listeners.slice()) {
        callback({ done: false, ...chunk })
      }
    },
    fireDone: (repoPath, hasMore) => {
      for (const callback of listeners.slice()) {
        callback({ repoPath, commits: [], done: true, hasMore })
      }
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
      for (const callback of listeners.slice()) {
        callback(evt)
      }
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
  vi.mocked(sidecarMock.getBranches).mockResolvedValue({
    _tag: 'Ok',
    branches: {
      current: branches.current,
      all: branches.all,
      remotes,
      tags,
      tracking: branches.tracking
    }
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  opHandlers.clear()
  clearAllSnapshots()
  vi.mocked(window.electronAPI.getSidebarPrefs).mockResolvedValue({ open: true, width: 256 })
  vi.mocked(window.electronAPI.getRefTreeToggles).mockResolvedValue([])
  vi.mocked(window.electronAPI.getPersistedTabs).mockResolvedValue({
    tabs: [null],
    activeIndex: 0
  })
  vi.mocked(window.electronAPI.setPersistedTabs).mockResolvedValue(undefined)
  vi.mocked(window.electronAPI.sidecarRequest).mockResolvedValue({ _tag: 'Ok' })
  vi.mocked(window.electronAPI.closeRepo).mockResolvedValue(undefined)
  sidecarMock.stashList.mockResolvedValue({ _tag: 'Ok', stashes: [] })
  mockBranchResponses({ current: '', all: [], remotes: [], tags: [] })
})

afterEach(() => {
  cleanup()
})

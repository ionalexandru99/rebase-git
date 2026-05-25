import '@testing-library/jest-dom/vitest'
import type {
  BranchesResponse,
  CommitResponse,
  FetchResponse,
  LogResponse,
  StageResponse,
  StatusResponse,
  UnstageResponse
} from '@shared/schemas/ipc'
import { beforeEach, vi } from 'vitest'
import { clearAllSnapshots } from '@/lib/repo-snapshot-cache'

export const sidecarMock = {
  getStatus: vi.fn<(repoPath: string) => Promise<StatusResponse>>(),
  getBranches: vi.fn<(repoPath: string) => Promise<BranchesResponse>>(),
  getLog: vi.fn<(repoPath: string) => Promise<LogResponse>>(),
  stageFile: vi.fn<(repoPath: string, file: string) => Promise<StageResponse>>(),
  unstageFile: vi.fn<(repoPath: string, file: string) => Promise<UnstageResponse>>(),
  commit: vi.fn<(repoPath: string, message: string) => Promise<CommitResponse>>(),
  fetchRepo: vi.fn<(repoPath: string) => Promise<FetchResponse>>()
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
        schema: { parse: (v: unknown) => unknown }
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
          default:
            throw new Error(`unhandled sidecar op in test: ${op}`)
        }
        return schema.parse(payload)
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
  getSidecarConfig: vi.fn()
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
    error?: string
  }) => void
  fireDone: (repoPath: string) => void
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
    fireDone: (repoPath) => {
      for (const callback of listeners.slice()) {
        callback({ repoPath, commits: [], done: true })
      }
    }
  }
}

export interface RepoChangedHandle {
  fire: (evt: { repoPath: string; kind: 'refs' | 'workingTree' }) => void
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

beforeEach(() => {
  vi.resetAllMocks()
  clearAllSnapshots()
  vi.mocked(window.electronAPI.getSidebarPrefs).mockResolvedValue({ open: true, width: 256 })
  vi.mocked(window.electronAPI.getRefTreeToggles).mockResolvedValue([])
  vi.mocked(window.electronAPI.getPersistedTabs).mockResolvedValue({
    tabs: [null],
    activeIndex: 0
  })
  vi.mocked(window.electronAPI.setPersistedTabs).mockResolvedValue(undefined)
  vi.mocked(window.electronAPI.getSidecarConfig).mockResolvedValue({
    baseUrl: 'http://127.0.0.1:9',
    token: 'test-token'
  })
})

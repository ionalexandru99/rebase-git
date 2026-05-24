import '@testing-library/jest-dom/vitest'
import { beforeEach, vi } from 'vitest'

vi.mock('@/lib/runtime', async () => {
  const { Effect, Layer, ManagedRuntime } = await import('effect')
  const { GitClient } = await import('@/lib/git-client')

  const dispatch = (op: string, body: Record<string, unknown>): Promise<unknown> => {
    const api = window.electronAPI
    const repoPath = body.repoPath as string
    switch (op) {
      case 'get-status':
        return api.getStatus(repoPath)
      case 'get-branches':
        return api.getBranches(repoPath)
      case 'get-log':
        return api.getLog(repoPath)
      case 'stage-file':
        return api.stageFile(repoPath, body.file as string)
      case 'unstage-file':
        return api.unstageFile(repoPath, body.file as string)
      case 'commit':
        return api.commit(repoPath, body.message as string)
      case 'fetch-repo':
        return api.fetchRepo(repoPath)
      default:
        return Promise.reject(new Error(`unhandled sidecar op in test: ${op}`))
    }
  }

  const TestGitClient = Layer.succeed(GitClient, {
    request: (op, body) =>
      Effect.tryPromise({
        try: () => dispatch(op, body),
        catch: (error) => (error instanceof Error ? error : new Error(String(error)))
      })
  })

  return {
    makeRuntime: <ROut, E>(layer: Layer.Layer<ROut, E>) => ManagedRuntime.make(layer),
    runtime: ManagedRuntime.make(TestGitClient),
    GitClient
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
  observe = vi.fn()
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
  getBranches: vi.fn(),
  checkoutRef: vi.fn(),
  getStatus: vi.fn(),
  stageFile: vi.fn(),
  unstageFile: vi.fn(),
  commit: vi.fn(),
  fetchRepo: vi.fn(),
  getLog: vi.fn(),
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
  getWorkingDirectory: vi.fn(),
  setWorkingDirectory: vi.fn(),
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
      const i = listeners.indexOf(cb as (chunk: unknown) => void)
      if (i !== -1) listeners.splice(i, 1)
    }
  })
  vi.mocked(window.electronAPI.startLogStream).mockResolvedValue({ _tag: 'Ok' })
  vi.mocked(window.electronAPI.cancelLogStream).mockResolvedValue({})
  return {
    fire: (chunk) => {
      for (const cb of listeners.slice()) {
        cb({ done: false, ...chunk })
      }
    },
    fireDone: (repoPath) => {
      for (const cb of listeners.slice()) {
        cb({ repoPath, commits: [], done: true })
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
      const i = listeners.indexOf(cb as (evt: unknown) => void)
      if (i !== -1) listeners.splice(i, 1)
    }
  })
  return {
    fire: (evt) => {
      for (const cb of listeners.slice()) cb(evt)
    }
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(window.electronAPI.getSidebarPrefs).mockResolvedValue({ open: true, width: 256 })
  vi.mocked(window.electronAPI.getRefTreeToggles).mockResolvedValue([])
  vi.mocked(window.electronAPI.getPersistedTabs).mockResolvedValue({
    tabs: [null],
    activeIndex: 0
  })
  vi.mocked(window.electronAPI.setPersistedTabs).mockResolvedValue(undefined)
})

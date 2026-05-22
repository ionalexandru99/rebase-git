import '@testing-library/jest-dom/vitest'
import { beforeEach, vi } from 'vitest'

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
  getStoreValue: vi.fn(),
  setStoreValue: vi.fn(),
  getWorkingDirectory: vi.fn(),
  setWorkingDirectory: vi.fn(),
  getWorkspaces: vi.fn(),
  addWorkspace: vi.fn(),
  removeWorkspace: vi.fn(),
  getActiveWorkspace: vi.fn(),
  setActiveWorkspace: vi.fn(),
  getOnboardingComplete: vi.fn(),
  setOnboardingComplete: vi.fn(),
  scanForRepos: vi.fn()
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
})

import '@testing-library/jest-dom/vitest'
import { beforeEach, vi } from 'vitest'

// jsdom doesn't implement matchMedia; sonner/next-themes/Radix rely on it.
// Use a regular function (not vi.fn) so vi.resetAllMocks() in beforeEach
// doesn't clear the implementation between tests.
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

// jsdom doesn't implement ResizeObserver, which Radix primitives need.
class ResizeObserverMock {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}
Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: ResizeObserverMock
})

// Mock the Electron API that is exposed via preload
const mockElectronAPI = {
  selectFolder: vi.fn(),
  openRepo: vi.fn(),
  getStatus: vi.fn(),
  stageFile: vi.fn(),
  unstageFile: vi.fn(),
  commit: vi.fn(),
  getLog: vi.fn(),
  getRecentRepos: vi.fn(),
  getStoreValue: vi.fn(),
  setStoreValue: vi.fn(),
  getWorkingDirectory: vi.fn(),
  setWorkingDirectory: vi.fn(),
  getOnboardingComplete: vi.fn(),
  setOnboardingComplete: vi.fn(),
  scanForRepos: vi.fn()
}

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true
})

// Reset mocks between tests
beforeEach(() => {
  vi.resetAllMocks()
})

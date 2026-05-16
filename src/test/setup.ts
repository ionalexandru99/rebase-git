import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

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
}

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
})

// Reset mocks between tests
beforeEach(() => {
  vi.resetAllMocks()
})

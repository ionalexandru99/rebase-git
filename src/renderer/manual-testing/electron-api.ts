import { clampListPaneWidth, LIST_PANE_DEFAULT_WIDTH } from '@shared/list-layout'
import type { LogChunk, RepoChangedEvent } from '@shared/schemas/git'
import type { CloneProgressEvent } from '@shared/schemas/ipc'
import type { LogStreamOptions } from '@shared/schemas/log-stream'
import type { IElectronAPI } from '../../preload'
import { createManualSidecarRequest } from './electron-api-sidecar'
import {
  createManualGitState,
  type ManualGitStateOptions,
  without,
  withValue
} from './electron-api-state'

const CLONE_PHASES: [string, number][] = [
  ['Counting objects', 40],
  ['Compressing objects', 72],
  ['Receiving objects', 96],
  ['Resolving deltas', 100]
]

export const PLAYWRIGHT_MCP_WORKSPACE_PATH = '/Users/playwright/Projects'
export const PLAYWRIGHT_MCP_REPO_PATH = `${PLAYWRIGHT_MCP_WORKSPACE_PATH}/rebase-demo`

export type PlaywrightMcpElectronApiOptions = ManualGitStateOptions

export function createPlaywrightMcpElectronApi(
  options: PlaywrightMcpElectronApiOptions = {}
): IElectronAPI {
  const state = createManualGitState(
    options,
    PLAYWRIGHT_MCP_WORKSPACE_PATH,
    PLAYWRIGHT_MCP_REPO_PATH
  )
  const logListeners = new Set<(chunk: LogChunk) => void>()
  const repoListeners = new Set<(event: RepoChangedEvent) => void>()
  const restartListeners = new Set<() => void>()
  const cloneListeners = new Set<(event: CloneProgressEvent) => void>()

  const notifyRepoChanged = (kind: RepoChangedEvent['kind']): void => {
    const event = { repoPath: PLAYWRIGHT_MCP_REPO_PATH, kind }
    for (const listener of repoListeners) {
      listener(event)
    }
  }

  const ok = { _tag: 'Ok' as const }
  const sidecarRequest = createManualSidecarRequest(state, {
    repoPath: PLAYWRIGHT_MCP_REPO_PATH,
    notifyRepoChanged
  })

  return {
    platform: 'darwin',
    selectFolder: async () => PLAYWRIGHT_MCP_WORKSPACE_PATH,
    openRepo: async (repoPath) => {
      if (repoPath !== PLAYWRIGHT_MCP_REPO_PATH) {
        return { _tag: 'NotARepo' }
      }
      return {
        _tag: 'Ok',
        result: {
          remotes: { origin: 'git@github.com:example/rebase-demo.git' },
          defaultBranch: 'main',
          path: PLAYWRIGHT_MCP_REPO_PATH
        }
      }
    },
    closeRepo: async () => {},
    disownRepo: async () => {},
    startLogStream: async (repoPath: string, streamOptions?: LogStreamOptions) => {
      if (repoPath !== PLAYWRIGHT_MCP_REPO_PATH) {
        return { _tag: 'GitError', message: `Repository is not open: ${repoPath}` }
      }
      const skip = streamOptions?.skip ?? 0
      const maxCount = streamOptions?.maxCount ?? state.commits.length
      const commits = state.commits
        .slice(skip, skip + maxCount)
        .map((commit) => ({ ...commit, parents: [...commit.parents] }))
      queueMicrotask(() => {
        const chunk = {
          repoPath,
          commits,
          done: true,
          hasMore: skip + commits.length < state.commits.length,
          streamId: streamOptions?.streamId
        }
        for (const listener of logListeners) {
          listener(chunk)
        }
      })
      return ok
    },
    cancelLogStream: async () => ({}),
    onLogChunk: (callback) => {
      logListeners.add(callback)
      return () => logListeners.delete(callback)
    },
    onRepoChanged: (callback) => {
      repoListeners.add(callback)
      return () => repoListeners.delete(callback)
    },
    onSidecarRestarted: (callback) => {
      restartListeners.add(callback)
      return () => restartListeners.delete(callback)
    },
    getRecentRepos: async () => [...state.recentRepos],
    getSidebarPrefs: async () => ({ ...state.sidebarPrefs }),
    setSidebarPrefs: async (prefs) => {
      state.sidebarPrefs = { ...prefs }
    },
    getRefTreeToggles: async () => [...state.refTreeToggles],
    setRefTreeToggles: async (toggles) => {
      state.refTreeToggles = [...toggles]
    },
    getPersistedTabs: async () => ({
      tabs: [...state.persistedTabs.tabs],
      activeIndex: state.persistedTabs.activeIndex
    }),
    setPersistedTabs: async (persistedTabs) => {
      state.persistedTabs = {
        tabs: [...persistedTabs.tabs],
        activeIndex: persistedTabs.activeIndex
      }
    },
    getListPaneWidth: async (repoPath) => state.listPaneWidths[repoPath] ?? LIST_PANE_DEFAULT_WIDTH,
    setListPaneWidth: async (repoPath, width) => {
      state.listPaneWidths[repoPath] = clampListPaneWidth(width)
    },
    getPullDivergedStrategy: async () => state.pullDivergedStrategy,
    setPullDivergedStrategy: async (strategy) => {
      state.pullDivergedStrategy = strategy
    },
    getReopenRepositoriesOnLaunch: async () => state.reopenRepositoriesOnLaunch,
    setReopenRepositoriesOnLaunch: async (reopen) => {
      state.reopenRepositoriesOnLaunch = reopen
    },
    getWorkspaces: async () => [...state.workspaces],
    addWorkspace: async (workspacePath) => {
      state.workspaces = withValue(state.workspaces, workspacePath)
      state.activeWorkspace = workspacePath
      return [...state.workspaces]
    },
    removeWorkspace: async (workspacePath) => {
      state.workspaces = without(state.workspaces, workspacePath)
      if (state.activeWorkspace === workspacePath) {
        state.activeWorkspace = state.workspaces[0] ?? null
      }
      return [...state.workspaces]
    },
    getActiveWorkspace: async () => state.activeWorkspace,
    setActiveWorkspace: async (workspacePath) => {
      state.activeWorkspace = workspacePath
    },
    getOnboardingComplete: async () => state.onboardingComplete,
    setOnboardingComplete: async (complete) => {
      state.onboardingComplete = complete
    },
    scanForRepos: async () => ({ _tag: 'Ok', repos: [PLAYWRIGHT_MCP_REPO_PATH] }),
    cloneRepo: async (request) => {
      for (const [phase, percent] of CLONE_PHASES) {
        for (const listener of cloneListeners) {
          listener({ cloneId: request.cloneId, phase, percent })
        }
        await new Promise((resolve) => setTimeout(resolve, 220))
      }
      return { _tag: 'Ok', path: PLAYWRIGHT_MCP_REPO_PATH }
    },
    cancelClone: async () => {},
    onCloneProgress: (callback) => {
      cloneListeners.add(callback)
      return () => cloneListeners.delete(callback)
    },
    sidecarRequest,
    reportRendererError: async (report) => {
      console.error('[crash] renderer stopped drawing', report)
    }
  }
}

export function installPlaywrightMcpElectronApi(
  options: PlaywrightMcpElectronApiOptions = {}
): void {
  window.electronAPI = createPlaywrightMcpElectronApi(options)
}

import { Deferred, Effect, Fiber } from 'effect'
import {
  createContext,
  createEffect,
  createSignal,
  onCleanup,
  type ParentProps,
  useContext
} from 'solid-js'
import { createStore } from 'solid-js/store'
import { writeSnapshotSync } from '@/lib/git-cache'
import {
  commitProgram,
  openLifecycle,
  runFetchAndRefresh,
  silentRefreshRefs,
  silentRefreshStatus,
  stageProgram,
  unstageProgram
} from '@/lib/git-effect/program'
import type { GitSetters } from '@/lib/git-effect/types'
import { runtime } from '@/lib/runtime'
import type { GitBranches, GitLog, GitLogEntry, GitStatus } from '@/types'

const AUTO_FETCH_INTERVAL_MS = 5 * 60 * 1000

export interface GitState {
  repoPath: string | null
  status: GitStatus | null
  log: GitLog | null
  branches: GitBranches | null
  remotes: Record<string, string>
  defaultBranch: string | undefined
  currentBranch: string
  opening: boolean
  committing: boolean
  statusLoading: boolean
  branchesLoading: boolean
  logLoading: boolean
  error: string | null
}

const initialState: GitState = {
  repoPath: null,
  status: null,
  log: null,
  branches: null,
  remotes: {},
  defaultBranch: undefined,
  currentBranch: '',
  opening: false,
  committing: false,
  statusLoading: false,
  branchesLoading: false,
  logLoading: false,
  error: null
}

export function createGitStore() {
  const [state, setState] = createStore<GitState>({ ...initialState })
  const [fetchTick, setFetchTick] = createSignal(0)

  let logBuffer: GitLogEntry[] = []
  let openFiber: Fiber.RuntimeFiber<void, never> | null = null

  const setters: GitSetters = {
    setRepoPath: (path) => setState('repoPath', path),
    setRemotes: (remotes) => setState('remotes', remotes),
    setDefaultBranch: (branch) => setState('defaultBranch', branch),
    setCurrentBranch: (branch) =>
      setState('currentBranch', (prev) => (typeof branch === 'function' ? branch(prev) : branch)),
    setStatus: (status) => setState('status', status),
    setBranches: (branches) => setState('branches', branches),
    setLog: (log) => setState('log', log),
    appendLogChunk: (commits) => {
      for (const commit of commits) logBuffer.push(commit)
      const log = { all: logBuffer.slice(), total: logBuffer.length }
      setState('log', log)
      if (state.repoPath) writeSnapshotSync(state.repoPath, { log })
    },
    resetLog: () => {
      logBuffer = []
    },
    setOpening: (value) => setState('opening', value),
    setCommitting: (value) => setState('committing', value),
    setStatusLoading: (value) => setState('statusLoading', value),
    setBranchesLoading: (value) => setState('branchesLoading', value),
    setLogLoading: (value) => setState('logLoading', value),
    setError: (message) => setState('error', message)
  }

  const reset = () => {
    logBuffer = []
    setState({ ...initialState })
  }

  const interruptOpen = () => {
    const fiber = openFiber
    openFiber = null
    if (fiber) Effect.runFork(Fiber.interrupt(fiber))
  }

  const openRepo = async (path: string) => {
    interruptOpen()
    const ready = await Effect.runPromise(Deferred.make<void>())
    openFiber = runtime.runFork(openLifecycle(path, setters, ready))
    await Effect.runPromise(Deferred.await(ready))
  }

  const closeRepo = async () => {
    interruptOpen()
    const path = state.repoPath
    if (path) {
      try {
        await window.electronAPI.cancelLogStream(path).catch(() => {})
        await window.electronAPI.closeRepo(path)
      } catch {}
    }
    reset()
  }

  const stageFile = async (file: string) => {
    if (!state.repoPath) return
    await runtime.runPromise(stageProgram(state.repoPath, file, setters))
  }

  const unstageFile = async (file: string) => {
    if (!state.repoPath) return
    await runtime.runPromise(unstageProgram(state.repoPath, file, setters))
  }

  const commit = async (message: string): Promise<boolean> => {
    if (!state.repoPath) return false
    return runtime.runPromise(commitProgram(state.repoPath, message, setters))
  }

  const fetchNow = async () => {
    if (!state.repoPath) return
    setFetchTick((tick) => tick + 1)
    await runtime.runPromise(runFetchAndRefresh(state.repoPath, setters))
  }

  const unsubLog = window.electronAPI.onLogChunk((chunk) => {
    if (chunk.repoPath !== state.repoPath) return
    if (chunk.commits.length > 0) setters.appendLogChunk(chunk.commits)
    if (chunk.error) setters.setError(chunk.error)
    if (chunk.done) setters.setLogLoading(false)
  })

  const unsubChanged = window.electronAPI.onRepoChanged((event) => {
    if (event.repoPath !== state.repoPath) return
    const refresh =
      event.kind === 'refs'
        ? silentRefreshRefs(event.repoPath, setters)
        : silentRefreshStatus(event.repoPath, setters)
    runtime.runFork(refresh)
  })

  createEffect(() => {
    const path = state.repoPath
    fetchTick()
    if (!path) return
    const handle = window.setInterval(() => {
      runtime.runFork(runFetchAndRefresh(path, setters))
    }, AUTO_FETCH_INTERVAL_MS)
    onCleanup(() => window.clearInterval(handle))
  })

  onCleanup(() => {
    interruptOpen()
    unsubLog?.()
    unsubChanged?.()
    const path = state.repoPath
    if (path) {
      Promise.resolve(window.electronAPI.cancelLogStream(path)).catch(() => {})
      Promise.resolve(window.electronAPI.closeRepo(path)).catch(() => {})
    }
  })

  return {
    state,
    loading: () => state.opening || state.committing,
    openRepo,
    closeRepo,
    stageFile,
    unstageFile,
    commit,
    fetchNow
  }
}

export type GitStore = ReturnType<typeof createGitStore>

const GitContext = createContext<GitStore>()

export function GitProvider(props: ParentProps) {
  const store = createGitStore()
  return <GitContext.Provider value={store}>{props.children}</GitContext.Provider>
}

export function useGitStore(): GitStore {
  const store = useContext(GitContext)
  if (!store) throw new Error('useGitStore must be used within GitProvider')
  return store
}

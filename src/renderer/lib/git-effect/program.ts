import { Deferred, Effect } from 'effect'
import * as api from './api'
import type { GitSetters } from './types'

const formatCause = (error: unknown): string => {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}

const loadStatus = (path: string, setters: GitSetters) =>
  Effect.gen(function* () {
    const response = yield* api.getStatus(path)
    yield* Effect.sync(() => {
      if (response._tag === 'Ok') {
        setters.setStatus(response.status)
        setters.setCurrentBranch(response.status.current)
      } else if (response._tag === 'GitError') {
        console.error('[useGit] get-status failed', { path, error: response.message })
        setters.setError(response.message)
      }
    })
  }).pipe(
    Effect.catchAll((error) =>
      Effect.sync(() => {
        console.error('[useGit] get-status threw', error)
        setters.setError(formatCause(error))
      })
    ),
    Effect.ensuring(Effect.sync(() => setters.setStatusLoading(false)))
  )

const loadBranches = (path: string, setters: GitSetters) =>
  Effect.gen(function* () {
    const response = yield* api.getBranches(path)
    yield* Effect.sync(() => {
      if (response._tag === 'Ok') {
        setters.setBranches(response.branches)
        setters.setCurrentBranch((prev) => prev || response.branches.current || '')
      } else if (response._tag === 'GitError') {
        console.error('[useGit] get-branches failed', { path, error: response.message })
        setters.setError(response.message)
      }
    })
  }).pipe(
    Effect.catchAll((error) =>
      Effect.sync(() => {
        console.error('[useGit] get-branches threw', error)
        setters.setError(formatCause(error))
      })
    ),
    Effect.ensuring(Effect.sync(() => setters.setBranchesLoading(false)))
  )

export const silentRefreshRefs = (path: string, setters: GitSetters) =>
  Effect.gen(function* () {
    const branchesResponse = yield* api.getBranches(path)
    yield* Effect.sync(() => {
      if (branchesResponse._tag === 'Ok') {
        setters.setBranches(branchesResponse.branches)
        if (branchesResponse.branches.current) {
          setters.setCurrentBranch(branchesResponse.branches.current)
        }
      }
    })

    const logResponse = yield* api.getLog(path)
    yield* Effect.sync(() => {
      if (logResponse._tag === 'Ok') {
        setters.setLog(logResponse.log)
      }
    })
  }).pipe(
    Effect.catchAll(() =>
      Effect.sync(() => {
        console.warn('[useGit] silent refresh refs failed')
      })
    )
  )

export const silentRefreshStatus = (path: string, setters: GitSetters) =>
  Effect.gen(function* () {
    const response = yield* api.getStatus(path)
    yield* Effect.sync(() => {
      if (response._tag === 'Ok') {
        setters.setStatus(response.status)
        setters.setCurrentBranch(response.status.current)
      }
    })
  }).pipe(
    Effect.catchAll(() =>
      Effect.sync(() => {
        console.warn('[useGit] silent refresh status failed')
      })
    )
  )

export const restartLogStream = (path: string, setters: GitSetters) =>
  Effect.gen(function* () {
    yield* Effect.sync(() => {
      setters.resetLog()
      setters.setLog({ all: [], total: 0 })
      setters.setLogLoading(true)
    })

    const startResponse = yield* api.startLogStream(path)
    if (startResponse._tag === 'GitError') {
      yield* Effect.sync(() => {
        setters.setError(startResponse.message)
        setters.setLogLoading(false)
      })
    }
  }).pipe(
    Effect.catchAll((error) =>
      Effect.sync(() => {
        setters.setError(formatCause(error))
        setters.setLogLoading(false)
      })
    )
  )

export const runFetchAndRefresh = (path: string, setters: GitSetters) =>
  Effect.gen(function* () {
    const response = yield* api.fetchRepo(path)
    if (response._tag !== 'Ok') {
      if (response._tag === 'GitError') {
        console.warn('[useGit] fetch failed', response.message)
      }
      return
    }
    yield* silentRefreshRefs(path, setters)
  }).pipe(
    Effect.catchAll((error) =>
      Effect.sync(() => {
        console.warn('[useGit] fetch failed', formatCause(error))
      })
    )
  )

export const openLifecycle = (
  path: string,
  setters: GitSetters,
  initialOpenReady: Deferred.Deferred<void>
) =>
  Effect.gen(function* () {
    yield* Effect.sync(() => {
      setters.setOpening(true)
      setters.setStatusLoading(true)
      setters.setBranchesLoading(true)
      setters.setError(null)
      setters.setStatus(null)
      setters.setBranches(null)
    })

    const openResponse = yield* api.openRepo(path)
    if (openResponse._tag !== 'Ok') {
      const errorMessage =
        openResponse._tag === 'NotARepo' ? 'Not a git repository' : openResponse.message
      console.error('[useGit] open-repo failed', { path, error: errorMessage })
      yield* Effect.sync(() => {
        setters.setError(errorMessage)
        setters.setOpening(false)
        setters.setStatusLoading(false)
        setters.setBranchesLoading(false)
      })
      return
    }

    const opened = openResponse.result
    yield* Effect.sync(() => {
      setters.setRepoPath(opened.path)
      setters.setRemotes(opened.remotes)
      setters.setDefaultBranch(opened.defaultBranch)
      setters.setOpening(false)
    })

    yield* Effect.all(
      [
        restartLogStream(opened.path, setters),
        loadStatus(opened.path, setters),
        loadBranches(opened.path, setters)
      ],
      { concurrency: 'unbounded' }
    )
    yield* Deferred.succeed(initialOpenReady, undefined)
  }).pipe(
    Effect.catchAll((error) =>
      Effect.sync(() => {
        console.error('[useGit] open lifecycle failed', error)
        setters.setError(formatCause(error))
        setters.setOpening(false)
        setters.setStatusLoading(false)
        setters.setBranchesLoading(false)
        setters.setLogLoading(false)
      })
    ),
    Effect.ensuring(Deferred.succeed(initialOpenReady, undefined))
  )

export const commitProgram = (path: string, message: string, setters: GitSetters) =>
  Effect.gen(function* () {
    yield* Effect.sync(() => setters.setCommitting(true))
    const response = yield* api.commit(path, message)
    if (response._tag === 'Ok') {
      yield* silentRefreshStatus(path, setters)
      yield* restartLogStream(path, setters)
      return true
    }
    if (response._tag === 'GitError') {
      yield* Effect.sync(() => setters.setError(response.message))
    }
    return false
  }).pipe(
    Effect.catchAll((error) =>
      Effect.sync(() => {
        setters.setError(formatCause(error))
        return false
      })
    ),
    Effect.ensuring(Effect.sync(() => setters.setCommitting(false)))
  )

export const stageProgram = (path: string, file: string, setters: GitSetters) =>
  Effect.gen(function* () {
    const response = yield* api.stageFile(path, file)
    if (response._tag === 'Ok') {
      yield* silentRefreshStatus(path, setters)
    } else if (response._tag === 'GitError') {
      yield* Effect.sync(() => setters.setError(response.message))
    }
  }).pipe(Effect.catchAll((error) => Effect.sync(() => setters.setError(formatCause(error)))))

export const unstageProgram = (path: string, file: string, setters: GitSetters) =>
  Effect.gen(function* () {
    const response = yield* api.unstageFile(path, file)
    if (response._tag === 'Ok') {
      yield* silentRefreshStatus(path, setters)
    } else if (response._tag === 'GitError') {
      yield* Effect.sync(() => setters.setError(response.message))
    }
  }).pipe(Effect.catchAll((error) => Effect.sync(() => setters.setError(formatCause(error)))))

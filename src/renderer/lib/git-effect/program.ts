import { Deferred, Effect } from 'effect'
import { hasCachedData, readSnapshot, writeSnapshot } from '@/lib/git-cache'
import type { GitClient } from '@/lib/git-client'
import type { GitStatus } from '@/types'
import * as api from './api'
import type { GitSetters } from './types'

const formatCause = (error: unknown): string => {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}

const withoutFile = (files: string[], file: string): string[] => files.filter((f) => f !== file)
const withFile = (files: string[], file: string): string[] =>
  files.includes(file) ? files : [...files, file]

const applyStage = (status: GitStatus, file: string): GitStatus => ({
  ...status,
  staged: withFile(status.staged, file),
  modified: withoutFile(status.modified, file),
  not_added: withoutFile(status.not_added, file),
  created: withoutFile(status.created, file),
  deleted: withoutFile(status.deleted, file)
})

const applyUnstage = (status: GitStatus, file: string): GitStatus => ({
  ...status,
  staged: withoutFile(status.staged, file),
  modified: withFile(status.modified, file)
})

const loadStatus = (path: string, setters: GitSetters) =>
  Effect.gen(function* () {
    const response = yield* api.getStatus(path)
    if (response._tag === 'Ok') {
      yield* writeSnapshot(path, {
        status: response.status,
        currentBranch: response.status.current
      })
      yield* Effect.sync(() => {
        setters.setStatus(response.status)
        setters.setCurrentBranch(response.status.current)
      })
    } else if (response._tag === 'GitError') {
      console.error('[useGit] get-status failed', { path, error: response.message })
      yield* Effect.sync(() => setters.setError(response.message))
    }
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
    if (response._tag === 'Ok') {
      yield* writeSnapshot(path, { branches: response.branches })
      yield* Effect.sync(() => {
        setters.setBranches(response.branches)
        setters.setCurrentBranch((prev) => prev || response.branches.current || '')
      })
    } else if (response._tag === 'GitError') {
      console.error('[useGit] get-branches failed', { path, error: response.message })
      yield* Effect.sync(() => setters.setError(response.message))
    }
  }).pipe(
    Effect.catchAll((error) =>
      Effect.sync(() => {
        console.error('[useGit] get-branches threw', error)
        setters.setError(formatCause(error))
      })
    ),
    Effect.ensuring(Effect.sync(() => setters.setBranchesLoading(false)))
  )

const refreshLog = (path: string, setters: GitSetters) =>
  Effect.gen(function* () {
    const response = yield* api.getLog(path)
    if (response._tag === 'Ok') {
      yield* writeSnapshot(path, { log: response.log })
      yield* Effect.sync(() => setters.setLog(response.log))
    }
  }).pipe(
    Effect.catchAll(() => Effect.sync(() => console.warn('[useGit] log refresh failed'))),
    Effect.ensuring(Effect.sync(() => setters.setLogLoading(false)))
  )

export const silentRefreshRefs = (path: string, setters: GitSetters) =>
  Effect.gen(function* () {
    const branchesResponse = yield* api.getBranches(path)
    if (branchesResponse._tag === 'Ok') {
      yield* writeSnapshot(path, { branches: branchesResponse.branches })
      yield* Effect.sync(() => {
        setters.setBranches(branchesResponse.branches)
        if (branchesResponse.branches.current) {
          setters.setCurrentBranch(branchesResponse.branches.current)
        }
      })
    }

    const logResponse = yield* api.getLog(path)
    if (logResponse._tag === 'Ok') {
      yield* writeSnapshot(path, { log: logResponse.log })
      yield* Effect.sync(() => setters.setLog(logResponse.log))
    }
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
    if (response._tag === 'Ok') {
      yield* writeSnapshot(path, {
        status: response.status,
        currentBranch: response.status.current
      })
      yield* Effect.sync(() => {
        setters.setStatus(response.status)
        setters.setCurrentBranch(response.status.current)
      })
    }
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
      setters.setError(null)
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
    yield* writeSnapshot(opened.path, {
      remotes: opened.remotes,
      defaultBranch: opened.defaultBranch
    })
    const cached = yield* readSnapshot(opened.path)

    yield* Effect.sync(() => {
      setters.setRepoPath(opened.path)
      setters.setRemotes(opened.remotes)
      setters.setDefaultBranch(opened.defaultBranch)
      setters.setOpening(false)
    })

    if (hasCachedData(cached)) {
      yield* Effect.sync(() => {
        if (cached?.status) {
          setters.setStatus(cached.status)
          setters.setCurrentBranch(cached.status.current)
        }
        if (cached?.branches) setters.setBranches(cached.branches)
        if (cached?.log) setters.setLog(cached.log)
        setters.setStatusLoading(false)
        setters.setBranchesLoading(false)
        setters.setLogLoading(false)
      })
      yield* Deferred.succeed(initialOpenReady, undefined)
      yield* Effect.all(
        [
          loadStatus(opened.path, setters),
          loadBranches(opened.path, setters),
          refreshLog(opened.path, setters)
        ],
        { concurrency: 'unbounded' }
      )
      return
    }

    yield* Effect.sync(() => {
      setters.setStatusLoading(true)
      setters.setBranchesLoading(true)
      setters.setStatus(null)
      setters.setBranches(null)
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

const optimisticProgram = <Response extends { readonly _tag: string }>(
  path: string,
  file: string,
  setters: GitSetters,
  apply: (status: GitStatus, file: string) => GitStatus,
  call: (path: string, file: string) => Effect.Effect<Response, Error, GitClient>
) =>
  Effect.gen(function* () {
    const cached = yield* readSnapshot(path)
    const previous = cached?.status

    if (previous) {
      const optimistic = apply(previous, file)
      yield* writeSnapshot(path, { status: optimistic })
      yield* Effect.sync(() => setters.setStatus(optimistic))
    }

    const rollback = Effect.gen(function* () {
      if (previous) {
        yield* writeSnapshot(path, { status: previous })
        yield* Effect.sync(() => setters.setStatus(previous))
      }
    })

    const response = yield* call(path, file).pipe(
      Effect.catchAll((error) =>
        Effect.succeed({ _tag: 'GitError' as const, message: formatCause(error) })
      )
    )

    if (response._tag === 'Ok') {
      yield* silentRefreshStatus(path, setters)
    } else {
      const message =
        'message' in response && typeof response.message === 'string'
          ? response.message
          : response._tag
      yield* rollback
      yield* Effect.sync(() => setters.setError(message))
    }
  })

export const stageProgram = (path: string, file: string, setters: GitSetters) =>
  optimisticProgram(path, file, setters, applyStage, api.stageFile)

export const unstageProgram = (path: string, file: string, setters: GitSetters) =>
  optimisticProgram(path, file, setters, applyUnstage, api.unstageFile)

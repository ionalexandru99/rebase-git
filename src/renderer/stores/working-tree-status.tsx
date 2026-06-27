import type { FileDiff } from '@shared/schemas/git'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, type RefObject, useCallback, useContext, useMemo, useRef } from 'react'
import { repoQueryKeys } from '@/lib/query-keys'
import {
  rpcGetDiff,
  rpcGetStatus,
  rpcStageAll,
  rpcStageFile,
  rpcStageHunk,
  rpcUnstageAll,
  rpcUnstageFile,
  rpcUnstageHunk
} from '@/lib/rpc-client'
import type { GitStatus } from '@/types'
import { useRepoSession } from './repo-session'

// Closed repos keep their status cached this long so reopening repaints instantly — scoped to this
// query (not the global default) so transient diff/hunk-highlight queries still expire normally.
const WARM_REOPEN_GC_TIME_MS = 30 * 60 * 1000

export interface HunkStageOptions {
  fullyStagesFile?: boolean
  fullyUnstagesFile?: boolean
}

type StatusMutationResult =
  | { _tag: 'Ok' }
  | { _tag: 'RepoNotOpen' }
  | { _tag: 'GitError'; message: string }
  | { _tag: 'HunkNotFound' }

interface StatusMutationContext {
  path: string
  generation: number
  key: readonly unknown[]
  previous: GitStatus | undefined
  hadOptimistic: boolean
}

const formatCause = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  return String(error)
}

const withoutFile = (files: string[], file: string): string[] => files.filter((f) => f !== file)
const withFile = (files: string[], file: string): string[] =>
  files.includes(file) ? files : [...files, file]

const stageCodes = (index: string, workingDir: string): { index: string; working_dir: string } => {
  if (index === '?' || workingDir === '?') {
    return { index: 'A', working_dir: ' ' }
  }
  return { index: workingDir !== ' ' ? workingDir : index, working_dir: ' ' }
}

const unstageCodes = (index: string): { index: string; working_dir: string } => {
  if (index === 'A') {
    return { index: '?', working_dir: '?' }
  }
  return { index: ' ', working_dir: index !== ' ' ? index : 'M' }
}

type StatusFileCode = NonNullable<GitStatus['files']>[number]

const mapFileCodes = (
  status: GitStatus,
  file: string,
  next: (entry: StatusFileCode) => { index: string; working_dir: string }
): StatusFileCode[] =>
  (status.files ?? []).map((entry) => (entry.path === file ? { ...entry, ...next(entry) } : entry))

const applyStage = (status: GitStatus, file: string): GitStatus => ({
  ...status,
  staged: withFile(status.staged, file),
  modified: withoutFile(status.modified, file),
  not_added: withoutFile(status.not_added, file),
  created: withoutFile(status.created, file),
  deleted: withoutFile(status.deleted, file),
  files: mapFileCodes(status, file, (entry) => stageCodes(entry.index, entry.working_dir))
})

const applyUnstage = (status: GitStatus, file: string): GitStatus => ({
  ...status,
  staged: withoutFile(status.staged, file),
  modified: withFile(status.modified, file),
  files: mapFileCodes(status, file, (entry) => unstageCodes(entry.index))
})

interface HunkMutationVars {
  op: 'stage' | 'unstage'
  file: string
  hunkHeader: string
  options: HunkStageOptions
}

export interface WorkingTreeStatusDeps {
  repoPath: string | null
  tabId: string
  liveRepoPath: RefObject<string | null>
  openGenerationRef: RefObject<number>
  isCurrentRepo: (generation: number, repoPath: string) => boolean
  setError: (error: string | null) => void
}

export interface WorkingTreeStatus {
  status: GitStatus | null
  statusLoading: boolean
  stageFile: (file: string) => Promise<StatusMutationResult | null>
  unstageFile: (file: string) => Promise<StatusMutationResult | null>
  stageAll: (files: string[]) => Promise<StatusMutationResult | null>
  unstageAll: (files: string[]) => Promise<StatusMutationResult | null>
  stageHunk: (file: string, hunkHeader: string, options?: HunkStageOptions) => Promise<boolean>
  unstageHunk: (file: string, hunkHeader: string, options?: HunkStageOptions) => Promise<boolean>
}

export interface WorkingTreeStatusController {
  status: GitStatus | null
  statusLoading: boolean
  statusError: unknown
  value: WorkingTreeStatus
}

export function useWorkingTreeStatusController(
  deps: WorkingTreeStatusDeps
): WorkingTreeStatusController {
  const queryClient = useQueryClient()
  const { repoPath, tabId, liveRepoPath, openGenerationRef, isCurrentRepo, setError } = deps

  // The queryFn fetches the repo encoded in its own key, not `liveRepoPath`: a refetch already in
  // flight when this tab is redirected to another repo must still resolve against the repo it was
  // started for, never write another repo's data under this key.
  const statusQuery = useQuery({
    queryKey: repoQueryKeys(repoPath, { idle: tabId }).status,
    enabled: Boolean(repoPath),
    gcTime: WARM_REOPEN_GC_TIME_MS,
    queryFn: async ({ queryKey }) => {
      const path = queryKey[1] as string
      const response = await rpcGetStatus(path)
      if (response._tag === 'GitError') {
        throw new Error(response.message)
      }
      if (response._tag !== 'Ok') {
        throw new Error('Repository not open')
      }
      return response.status
    }
  })

  const resyncStatusAndDiffs = (context: StatusMutationContext) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: context.key }),
      queryClient.invalidateQueries({ queryKey: repoQueryKeys(context.path).diffRoot })
    ])

  // Every mutation re-syncs status+diffs from the sidecar after it settles, success or failure.
  // On failure the optimistic write is first rolled back to the snapshot, but the snapshot can
  // itself be a concurrent same-file mutation's optimistic value (the rollback target is captured
  // in onMutate), so the authoritative refetch is what guarantees the cache converges — and it also
  // corrects a stale diff behind a HunkNotFound.
  const statusMutationOptions = <Vars,>(
    applyOptimistic: (current: GitStatus, vars: Vars) => GitStatus | null,
    request: (path: string, vars: Vars) => Promise<StatusMutationResult>
  ) => ({
    mutationFn: async (vars: Vars): Promise<StatusMutationResult | null> => {
      const path = liveRepoPath.current
      if (!path) {
        return null
      }
      return request(path, vars)
    },
    onMutate: async (vars: Vars): Promise<StatusMutationContext | undefined> => {
      const path = liveRepoPath.current
      if (!path) {
        return undefined
      }
      const key = repoQueryKeys(path).status
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<GitStatus>(key)
      const optimistic = previous ? applyOptimistic(previous, vars) : null
      if (optimistic) {
        queryClient.setQueryData<GitStatus>(key, optimistic)
      }
      return {
        path,
        generation: openGenerationRef.current,
        key,
        previous,
        hadOptimistic: Boolean(optimistic)
      }
    },
    onError: (error: unknown, _vars: Vars, context: StatusMutationContext | undefined) => {
      if (context?.hadOptimistic && context.previous) {
        queryClient.setQueryData<GitStatus>(context.key, context.previous)
      }
      if (context && isCurrentRepo(context.generation, context.path)) {
        setError(formatCause(error))
      }
      if (context) {
        return resyncStatusAndDiffs(context)
      }
      return undefined
    },
    onSuccess: (
      response: StatusMutationResult | null,
      _vars: Vars,
      context: StatusMutationContext | undefined
    ) => {
      if (!response || !context) {
        return undefined
      }
      if (response._tag === 'Ok') {
        return resyncStatusAndDiffs(context)
      }
      if (context.hadOptimistic && context.previous) {
        queryClient.setQueryData<GitStatus>(context.key, context.previous)
      }
      if (response._tag === 'GitError' && isCurrentRepo(context.generation, context.path)) {
        setError(response.message)
      }
      return resyncStatusAndDiffs(context)
    }
  })

  const stageMutation = useMutation(
    statusMutationOptions<string>(
      (current, file) => applyStage(current, file),
      (path, file) => rpcStageFile(path, file)
    )
  )

  const unstageMutation = useMutation(
    statusMutationOptions<string>(
      (current, file) => applyUnstage(current, file),
      (path, file) => rpcUnstageFile(path, file)
    )
  )

  const stageAllMutation = useMutation(
    statusMutationOptions<string[]>(
      (current, files) => files.reduce((next, file) => applyStage(next, file), current),
      (path, files) => rpcStageAll(path, files)
    )
  )

  const unstageAllMutation = useMutation(
    statusMutationOptions<string[]>(
      (current, files) => files.reduce((next, file) => applyUnstage(next, file), current),
      (path, files) => rpcUnstageAll(path, files)
    )
  )

  const hunkMutation = useMutation(
    statusMutationOptions<HunkMutationVars>(
      (current, vars) => {
        if (vars.op === 'stage' && vars.options.fullyStagesFile) {
          return applyStage(current, vars.file)
        }
        if (vars.op === 'unstage' && vars.options.fullyUnstagesFile) {
          return applyUnstage(current, vars.file)
        }
        return null
      },
      (path, vars) =>
        vars.op === 'stage'
          ? rpcStageHunk(path, vars.file, vars.hunkHeader)
          : rpcUnstageHunk(path, vars.file, vars.hunkHeader)
    )
  )

  // The IPC-free mutation handles below are stable across renders so the context value only changes
  // when status data does — a status-only consumer never re-renders on an unrelated concern (e.g. a
  // streamed commit). The mutations are read through a ref because react-query hands back a fresh
  // result object each render.
  const mutations = useRef({
    stage: stageMutation,
    unstage: unstageMutation,
    stageAll: stageAllMutation,
    unstageAll: unstageAllMutation,
    hunk: hunkMutation
  })
  mutations.current = {
    stage: stageMutation,
    unstage: unstageMutation,
    stageAll: stageAllMutation,
    unstageAll: unstageAllMutation,
    hunk: hunkMutation
  }

  const stageFile = useCallback((file: string) => mutations.current.stage.mutateAsync(file), [])
  const unstageFile = useCallback((file: string) => mutations.current.unstage.mutateAsync(file), [])
  const stageAll = useCallback(
    (files: string[]) => mutations.current.stageAll.mutateAsync(files),
    []
  )
  const unstageAll = useCallback(
    (files: string[]) => mutations.current.unstageAll.mutateAsync(files),
    []
  )
  const stageHunk = useCallback(
    (file: string, hunkHeader: string, options: HunkStageOptions = {}) =>
      mutations.current.hunk
        .mutateAsync({ op: 'stage', file, hunkHeader, options })
        .then((response) => response?._tag === 'Ok'),
    []
  )
  const unstageHunk = useCallback(
    (file: string, hunkHeader: string, options: HunkStageOptions = {}) =>
      mutations.current.hunk
        .mutateAsync({ op: 'unstage', file, hunkHeader, options })
        .then((response) => response?._tag === 'Ok'),
    []
  )

  const status = statusQuery.data ?? null
  const statusLoading = statusQuery.isFetching && !statusQuery.data

  const value = useMemo<WorkingTreeStatus>(
    () => ({
      status,
      statusLoading,
      stageFile,
      unstageFile,
      stageAll,
      unstageAll,
      stageHunk,
      unstageHunk
    }),
    [status, statusLoading, stageFile, unstageFile, stageAll, unstageAll, stageHunk, unstageHunk]
  )

  return { status, statusLoading, statusError: statusQuery.error, value }
}

const WorkingTreeStatusContext = createContext<WorkingTreeStatus | null>(null)

export const WorkingTreeStatusProvider = WorkingTreeStatusContext.Provider

export function useWorkingTreeStatus(): WorkingTreeStatus {
  const value = useContext(WorkingTreeStatusContext)
  if (!value) {
    throw new Error('useWorkingTreeStatus must be used within a GitStoreProvider')
  }
  return value
}

export function useFileDiff(file: string | null, staged: boolean) {
  const { repoPath } = useRepoSession()
  const queryKeys = repoQueryKeys(repoPath, { idle: 'diff-panel' })
  return useQuery({
    queryKey: file ? queryKeys.diff(file, staged) : queryKeys.diff('none', staged),
    enabled: Boolean(repoPath && file),
    queryFn: async (): Promise<FileDiff> => {
      if (!repoPath || !file) {
        throw new Error('No file selected')
      }
      const response = await rpcGetDiff(repoPath, file, staged)
      if (response._tag === 'Ok') {
        return response.diff
      }
      if (response._tag === 'GitError') {
        throw new Error(response.message)
      }
      throw new Error('Repository not open')
    }
  })
}

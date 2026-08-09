import type { RepoRef } from '@common/features/repository-identity'
import type { HunkLineSelection } from '@shared/rpc'
import type { HeadCommit } from '@shared/schemas/git'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, type RefObject, useCallback, useContext, useMemo, useRef } from 'react'
import { type RepositoryIdentity, repoQueryKeys } from '@/features/repository-identity'
import { buildUnifiedFileRows, type UnifiedFileRow } from '@/features/status/status-file-rows'
import {
  createStatusMutationOptions,
  type StatusMutationResult
} from '@/features/status/status-mutation-lifecycle'
import { applyStageToStatus, applyUnstageToStatus } from '@/features/status/status-transitions'
import { WARM_REOPEN_GC_TIME_MS } from '@/lib/query-config'
import {
  rpcDiscardHunk,
  rpcGetDiff,
  rpcGetHeadCommit,
  rpcGetStatus,
  rpcStageAll,
  rpcStageFile,
  rpcStageHunk,
  rpcStageLines,
  rpcUnstageAll,
  rpcUnstageFile,
  rpcUnstageHunk,
  rpcUnstageLines
} from '@/lib/rpc-client'
import { unwrapOk } from '@/lib/unwrap-rpc-result'
import type { GitStatus } from '@/types'
import type { RepoMutationCoordinator } from '../../stores/action-runner'
import { type RepoSessionErrorSource, useRepoSession } from '../../stores/repo-session'

export interface HunkStageOptions {
  fullyStagesFile?: boolean
  fullyUnstagesFile?: boolean
}

interface FileMutationVars {
  file: string
  renameSource?: string
}

interface HunkMutationVars {
  op: 'stage' | 'unstage' | 'discard'
  file: string
  hunkHeader: string
  options: HunkStageOptions
}

interface LineMutationVars {
  op: 'stage' | 'unstage'
  file: string
  selections: readonly HunkLineSelection[]
}

export interface WorkingTreeStatusDeps {
  repoPath: string | null
  repository: RepoRef | null
  tabId: string
  liveRepoRef: RefObject<RepoRef | null>
  openGenerationRef: RefObject<number>
  isCurrentRepo: (generation: number, repository: RepositoryIdentity) => boolean
  setError: (source: RepoSessionErrorSource, error: string) => void
  clearError: (source: RepoSessionErrorSource) => void
  mutationCoordinator: RepoMutationCoordinator
}

export interface WorkingTreeStatus {
  status: GitStatus | null
  rows: UnifiedFileRow[]
  statusState: 'loading' | 'ready' | 'error'
  statusLoading: boolean
  stageFile: (file: string) => Promise<StatusMutationResult | null>
  unstageFile: (file: string, renameSource?: string) => Promise<StatusMutationResult | null>
  stageAll: (files: string[]) => Promise<StatusMutationResult | null>
  unstageAll: (files: string[]) => Promise<StatusMutationResult | null>
  stageHunk: (file: string, hunkHeader: string, options?: HunkStageOptions) => Promise<boolean>
  unstageHunk: (file: string, hunkHeader: string, options?: HunkStageOptions) => Promise<boolean>
  discardHunk: (file: string, hunkHeader: string) => Promise<boolean>
  stageLines: (file: string, selections: readonly HunkLineSelection[]) => Promise<boolean>
  unstageLines: (file: string, selections: readonly HunkLineSelection[]) => Promise<boolean>
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
  const {
    repoPath,
    repository,
    tabId,
    liveRepoRef,
    openGenerationRef,
    isCurrentRepo,
    setError,
    clearError,
    mutationCoordinator
  } = deps
  const runMutation = mutationCoordinator.run

  const statusQuery = useQuery({
    queryKey: repoQueryKeys(repository, { idle: tabId }).status,
    enabled: Boolean(repoPath),
    gcTime: WARM_REOPEN_GC_TIME_MS,
    queryFn: async () => unwrapOk(await rpcGetStatus(repoPath as string)).status
  })

  const statusMutationOptions = <Vars,>(
    applyOptimistic: (current: GitStatus, vars: Vars) => GitStatus | null,
    request: (path: string, vars: Vars) => Promise<StatusMutationResult>
  ) =>
    createStatusMutationOptions(
      {
        queryClient,
        getRepository: () => liveRepoRef.current,
        getGeneration: () => openGenerationRef.current,
        isCurrentRepo,
        setMutationError: (error) => setError('mutation', error),
        clearMutationError: () => clearError('mutation')
      },
      applyOptimistic,
      request
    )

  const stageMutation = useMutation(
    statusMutationOptions<string>(
      (current, file) => applyStageToStatus(current, file),
      (path, file) => rpcStageFile(path, file)
    )
  )

  const unstageMutation = useMutation(
    statusMutationOptions<FileMutationVars>(
      (current, vars) => applyUnstageToStatus(current, vars.file),
      (path, vars) => rpcUnstageFile(path, vars.file, vars.renameSource)
    )
  )

  const stageAllMutation = useMutation(
    statusMutationOptions<string[]>(
      (current, files) => files.reduce((next, file) => applyStageToStatus(next, file), current),
      (path, files) => rpcStageAll(path, files)
    )
  )

  const unstageAllMutation = useMutation(
    statusMutationOptions<string[]>(
      (current, files) => files.reduce((next, file) => applyUnstageToStatus(next, file), current),
      (path, files) => rpcUnstageAll(path, files)
    )
  )

  const hunkMutation = useMutation(
    statusMutationOptions<HunkMutationVars>(
      (current, vars) => {
        if (vars.op === 'stage' && vars.options.fullyStagesFile) {
          return applyStageToStatus(current, vars.file)
        }
        if (vars.op === 'unstage' && vars.options.fullyUnstagesFile) {
          return applyUnstageToStatus(current, vars.file)
        }
        return null
      },
      (path, vars) =>
        vars.op === 'stage'
          ? rpcStageHunk(path, vars.file, vars.hunkHeader)
          : vars.op === 'unstage'
            ? rpcUnstageHunk(path, vars.file, vars.hunkHeader)
            : rpcDiscardHunk(path, vars.file, vars.hunkHeader)
    )
  )

  const linesMutation = useMutation(
    statusMutationOptions<LineMutationVars>(
      () => null,
      (path, vars) =>
        vars.op === 'stage'
          ? rpcStageLines(path, vars.file, vars.selections)
          : rpcUnstageLines(path, vars.file, vars.selections)
    )
  )

  const mutations = useRef({
    stage: stageMutation,
    unstage: unstageMutation,
    stageAll: stageAllMutation,
    unstageAll: unstageAllMutation,
    hunk: hunkMutation,
    lines: linesMutation
  })
  mutations.current = {
    stage: stageMutation,
    unstage: unstageMutation,
    stageAll: stageAllMutation,
    unstageAll: unstageAllMutation,
    hunk: hunkMutation,
    lines: linesMutation
  }

  const stageFile = useCallback(
    (file: string) => runMutation('stage', null, () => mutations.current.stage.mutateAsync(file)),
    [runMutation]
  )
  const unstageFile = useCallback(
    (file: string, renameSource?: string) =>
      runMutation('unstage', null, () =>
        mutations.current.unstage.mutateAsync({ file, renameSource })
      ),
    [runMutation]
  )
  const stageAll = useCallback(
    (files: string[]) =>
      runMutation('stage', null, () => mutations.current.stageAll.mutateAsync(files)),
    [runMutation]
  )
  const unstageAll = useCallback(
    (files: string[]) =>
      runMutation('unstage', null, () => mutations.current.unstageAll.mutateAsync(files)),
    [runMutation]
  )
  const stageHunk = useCallback(
    (file: string, hunkHeader: string, options: HunkStageOptions = {}) =>
      runMutation('stage', false, () =>
        mutations.current.hunk
          .mutateAsync({ op: 'stage', file, hunkHeader, options })
          .then((response) => response?._tag === 'Ok')
      ),
    [runMutation]
  )
  const unstageHunk = useCallback(
    (file: string, hunkHeader: string, options: HunkStageOptions = {}) =>
      runMutation('unstage', false, () =>
        mutations.current.hunk
          .mutateAsync({ op: 'unstage', file, hunkHeader, options })
          .then((response) => response?._tag === 'Ok')
      ),
    [runMutation]
  )

  const discardHunk = useCallback(
    (file: string, hunkHeader: string) =>
      runMutation('discard', false, () =>
        mutations.current.hunk
          .mutateAsync({ op: 'discard', file, hunkHeader, options: {} })
          .then((response) => response?._tag === 'Ok')
      ),
    [runMutation]
  )

  const stageLines = useCallback(
    (file: string, selections: readonly HunkLineSelection[]) =>
      runMutation('stage', false, () =>
        mutations.current.lines
          .mutateAsync({ op: 'stage', file, selections })
          .then((response) => response?._tag === 'Ok')
      ),
    [runMutation]
  )

  const unstageLines = useCallback(
    (file: string, selections: readonly HunkLineSelection[]) =>
      runMutation('unstage', false, () =>
        mutations.current.lines
          .mutateAsync({ op: 'unstage', file, selections })
          .then((response) => response?._tag === 'Ok')
      ),
    [runMutation]
  )

  const status = statusQuery.data ?? null
  const rows = useMemo(() => (status ? buildUnifiedFileRows(status) : []), [status])
  const statusState = status ? 'ready' : statusQuery.isError ? 'error' : 'loading'
  const statusLoading = statusQuery.isFetching && !statusQuery.data

  const value = useMemo<WorkingTreeStatus>(
    () => ({
      status,
      rows,
      statusState,
      statusLoading,
      stageFile,
      unstageFile,
      stageAll,
      unstageAll,
      stageHunk,
      unstageHunk,
      discardHunk,
      stageLines,
      unstageLines
    }),
    [
      status,
      rows,
      statusState,
      statusLoading,
      stageFile,
      unstageFile,
      stageAll,
      unstageAll,
      stageHunk,
      unstageHunk,
      discardHunk,
      stageLines,
      unstageLines
    ]
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

export function useFileDiff(file: string | null, staged: boolean, range?: string) {
  const { repoRef, repoPath } = useRepoSession()
  const queryKeys = repoQueryKeys(repoRef, { idle: 'diff-panel' })
  return useQuery({
    queryKey: file ? queryKeys.diff(file, staged, range) : queryKeys.diff('none', staged, range),
    enabled: Boolean(repoPath && file),
    queryFn: async (): Promise<{ patch: string; binary: boolean }> => {
      if (!repoPath || !file) {
        throw new Error('No file selected')
      }
      const response = unwrapOk(await rpcGetDiff(repoPath, file, staged, { range }))
      return { patch: response.patch, binary: response.binary }
    }
  })
}

export function useCommitFileDiff(sha: string | null, file: string | null, renameSource?: string) {
  const { repoRef, repoPath } = useRepoSession()
  const queryKeys = repoQueryKeys(repoRef, { idle: 'commit-diff' })
  return useQuery({
    queryKey: queryKeys.commitDiff(sha ?? 'none', file ?? 'none'),
    enabled: Boolean(repoPath && sha && file),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: WARM_REOPEN_GC_TIME_MS,
    queryFn: async (): Promise<{ patch: string; binary: boolean }> => {
      if (!repoPath || !sha || !file) {
        throw new Error('No commit file selected')
      }
      const response = unwrapOk(
        await rpcGetDiff(repoPath, file, false, { commit: sha, renameSource })
      )
      return { patch: response.patch, binary: response.binary }
    }
  })
}

export function useHeadCommit(enabled: boolean) {
  const { repoRef, repoPath } = useRepoSession()
  const queryKeys = repoQueryKeys(repoRef, { idle: 'head-commit' })
  return useQuery({
    queryKey: queryKeys.headCommit,
    enabled: enabled && Boolean(repoPath),
    staleTime: 0,
    queryFn: async (): Promise<HeadCommit> => {
      if (!repoPath) {
        throw new Error('No repository open')
      }
      return unwrapOk(await rpcGetHeadCommit(repoPath)).result
    }
  })
}

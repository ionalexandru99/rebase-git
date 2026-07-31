import type { HunkLineSelection } from '@shared/rpc'
import type { FileDiff, HeadCommit } from '@shared/schemas/git'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, type RefObject, useCallback, useContext, useMemo, useRef } from 'react'
import { buildUnifiedFileRows, type UnifiedFileRow } from '@/features/status/status-file-rows'
import { formatCause } from '@/lib/format-cause'
import { engineFailureBannerText, gitFailureBannerText } from '@/lib/git-report'
import { WARM_REOPEN_GC_TIME_MS } from '@/lib/query-config'
import { repoQueryKeys } from '@/lib/query-keys'
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

type StatusMutationResult =
  | { _tag: 'Ok' }
  | { _tag: 'RepoNotOpen' }
  | { _tag: 'GitError'; message: string }
  | { _tag: 'HunkNotFound' }
  | { _tag: 'OperationInProgress'; operation: string }

interface StatusMutationContext {
  path: string
  generation: number
  key: readonly unknown[]
  previous: GitStatus | undefined
  hadOptimistic: boolean
}

interface FileMutationVars {
  file: string
  renameSource?: string
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
  tabId: string
  liveRepoPath: RefObject<string | null>
  openGenerationRef: RefObject<number>
  isCurrentRepo: (generation: number, repoPath: string) => boolean
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
    tabId,
    liveRepoPath,
    openGenerationRef,
    isCurrentRepo,
    setError,
    clearError,
    mutationCoordinator
  } = deps
  const runMutation = mutationCoordinator.run

  const statusQuery = useQuery({
    queryKey: repoQueryKeys(repoPath, { idle: tabId }).status,
    enabled: Boolean(repoPath),
    gcTime: WARM_REOPEN_GC_TIME_MS,
    queryFn: async ({ queryKey }) => {
      const path = queryKey[1] as string
      return unwrapOk(await rpcGetStatus(path)).status
    }
  })

  const resyncStatusAndDiffs = (context: StatusMutationContext) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: context.key }),
      queryClient.invalidateQueries({ queryKey: repoQueryKeys(context.path).diffRoot })
    ])

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
        setError('mutation', engineFailureBannerText('The change did not run', formatCause(error)))
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
        if (isCurrentRepo(context.generation, context.path)) {
          clearError('mutation')
        }
        return resyncStatusAndDiffs(context)
      }
      if (context.hadOptimistic && context.previous) {
        queryClient.setQueryData<GitStatus>(context.key, context.previous)
      }
      if (response._tag === 'GitError' && isCurrentRepo(context.generation, context.path)) {
        setError('mutation', gitFailureBannerText('Git rejected the change', response.message))
      }
      if (
        response._tag === 'OperationInProgress' &&
        isCurrentRepo(context.generation, context.path)
      ) {
        setError('mutation', `Finish or abort the in-progress ${response.operation} first.`)
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
    statusMutationOptions<FileMutationVars>(
      (current, vars) => applyUnstage(current, vars.file),
      (path, vars) => rpcUnstageFile(path, vars.file, vars.renameSource)
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
  const { repoPath } = useRepoSession()
  const queryKeys = repoQueryKeys(repoPath, { idle: 'diff-panel' })
  return useQuery({
    queryKey: file ? queryKeys.diff(file, staged, range) : queryKeys.diff('none', staged, range),
    enabled: Boolean(repoPath && file),
    queryFn: async (): Promise<{ diff: FileDiff; patch: string }> => {
      if (!repoPath || !file) {
        throw new Error('No file selected')
      }
      const response = unwrapOk(await rpcGetDiff(repoPath, file, staged, { range }))
      return { diff: response.diff, patch: response.patch }
    }
  })
}

export function useCommitFileDiff(sha: string | null, file: string | null, renameSource?: string) {
  const { repoPath } = useRepoSession()
  const queryKeys = repoQueryKeys(repoPath, { idle: 'commit-diff' })
  return useQuery({
    queryKey: queryKeys.commitDiff(sha ?? 'none', file ?? 'none'),
    enabled: Boolean(repoPath && sha && file),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: WARM_REOPEN_GC_TIME_MS,
    queryFn: async (): Promise<{ diff: FileDiff; patch: string }> => {
      if (!repoPath || !sha || !file) {
        throw new Error('No commit file selected')
      }
      const response = unwrapOk(
        await rpcGetDiff(repoPath, file, false, { commit: sha, renameSource })
      )
      return { diff: response.diff, patch: response.patch }
    }
  })
}

export function useHeadCommit(enabled: boolean) {
  const { repoPath } = useRepoSession()
  const queryKeys = repoQueryKeys(repoPath, { idle: 'head-commit' })
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

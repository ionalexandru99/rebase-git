import type { LostCommit } from '@shared/git-rpc-errors'
import { AmendCommit, Commit, Pull, Push } from '@shared/rpc'
import { useMutation } from '@tanstack/react-query'
import {
  createContext,
  type RefObject,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState
} from 'react'
import { toast } from 'sonner'
import { formatCause } from '@/lib/format-cause'
import { toastEngineFailure, toastGitFailure } from '@/lib/git-report'
import { cachesForOperation, type MappedOperation, type RepoCache } from '@/lib/operation-caches'
import {
  type PullStrategy,
  type PushForce,
  rpcAmendCommit,
  rpcCommit,
  rpcGetHeadCommit,
  rpcPull,
  rpcPush
} from '@/lib/rpc-client'
import { decidePullResponse, type PullNotice, type PullOutcome } from './action-runner-outcomes'

export type { PullOutcome } from './action-runner-outcomes'

export type PushRejectionReason = 'non-fast-forward' | 'lease-stale' | 'remote-moved'

export type PushOutcome =
  | { kind: 'ok' }
  | {
      kind: 'rejected'
      reason: PushRejectionReason
      lostCommits: readonly LostCommit[]
      remoteSha?: string
    }
  | { kind: 'error'; message: string }

export interface RunActionOptions {
  silentSuccess?: boolean
  failureLabel?: string
  conflictDescription?: string
}

export type RunAction = (
  operation: MappedOperation,
  call: (repoPath: string) => Promise<{ _tag: string; message?: string; operation?: string }>,
  label: string,
  options?: RunActionOptions
) => Promise<boolean>

export interface ActionRunner {
  runAction: RunAction
  commit: (message: string) => Promise<boolean>
  amend: (
    message: string,
    droppedHeadPaths: string[],
    droppedHeadHunks: { file: string; hunks: string[] }[],
    expectedHead: string
  ) => Promise<boolean>
  loadHeadMessage: () => Promise<string | null>
  pushNow: () => Promise<boolean>
  push: (force?: PushForce, expectedRemoteSha?: string) => Promise<PushOutcome>
  pull: (strategy?: PullStrategy) => Promise<PullOutcome>
  pullNow: () => Promise<boolean>
  committing: boolean
  amending: boolean
  pushing: boolean
  pulling: boolean
  busy: boolean
}

const notifyBusy = (): void => {
  toast.info('Another Git action is still running', {
    description: 'Wait for it to finish, then try again.'
  })
}

const showPullNotice = (notice: PullNotice | undefined): void => {
  if (!notice) {
    return
  }
  if (notice.kind === 'success') {
    toast.success(notice.title)
    return
  }
  if (notice.kind === 'warning') {
    toast.warning(notice.title, { description: notice.description })
    return
  }
  if (notice.kind === 'error') {
    toast.error(notice.title)
    return
  }
  toastGitFailure(notice.title, notice.message)
}

const pushLabel = (force?: PushForce): string => {
  if (force === 'overwrite') {
    return 'Overwrote remote'
  }
  if (force === 'with-lease') {
    return 'Force pushed'
  }
  return 'Pushed'
}

export interface ActionRunnerDeps {
  liveRepoPath: RefObject<string | null>
  openGenerationRef: RefObject<number>
  isCurrentRepo: (generation: number, repoPath: string) => boolean
  refreshCaches: (repoPath: string, caches: readonly RepoCache[]) => Promise<unknown>
  mutationCoordinator: RepoMutationCoordinator
}

export interface RepoMutationCoordinator {
  activeOperation: string | null
  run: <Result>(
    operation: string,
    rejectedResult: Result,
    task: () => Promise<Result>,
    onRejected?: () => void
  ) => Promise<Result>
}

export function useRepoMutationCoordinator(): RepoMutationCoordinator {
  const activeRef = useRef<string | null>(null)
  const [activeOperation, setActiveOperation] = useState<string | null>(null)
  const run = useCallback(
    async <Result,>(
      operation: string,
      rejectedResult: Result,
      task: () => Promise<Result>,
      onRejected?: () => void
    ) => {
      if (activeRef.current) {
        onRejected?.()
        return rejectedResult
      }
      activeRef.current = operation
      setActiveOperation(operation)
      try {
        return await task()
      } finally {
        activeRef.current = null
        setActiveOperation(null)
      }
    },
    []
  )
  return useMemo(() => ({ activeOperation, run }), [activeOperation, run])
}

export function useActionRunnerController(deps: ActionRunnerDeps): ActionRunner {
  const { liveRepoPath, openGenerationRef, isCurrentRepo, refreshCaches, mutationCoordinator } =
    deps
  const depsRef = useRef(deps)
  depsRef.current = deps

  const runActionAttempt = useCallback<RunAction>(async (operation, call, label, options) => {
    const { liveRepoPath, openGenerationRef, isCurrentRepo, refreshCaches } = depsRef.current
    const repoPath = liveRepoPath.current
    if (!repoPath) {
      toast.error('Repository is not open')
      return false
    }
    const generation = openGenerationRef.current
    const failedTitle = `${options?.failureLabel ?? label} failed`
    try {
      const response = await call(repoPath)
      if (!isCurrentRepo(generation, repoPath)) {
        return false
      }
      if (response._tag === 'Ok' || response._tag === 'Conflict') {
        await refreshCaches(repoPath, cachesForOperation(operation))
      }
      if (response._tag === 'Ok') {
        if (!options?.silentSuccess) {
          toast.success(label)
        }
        return true
      }
      if (response._tag === 'Conflict') {
        toast.warning(`${label} hit conflicts`, {
          description:
            options?.conflictDescription ?? 'Resolve the conflicted files, then commit or abort.'
        })
        return false
      }
      if (response._tag === 'OperationInProgress') {
        toast.warning('Another Git operation is in progress', {
          description: `Finish or abort the in-progress ${response.operation} first.`
        })
        return false
      }
      if (response._tag === 'GitError') {
        toastGitFailure(failedTitle, response.message ?? '')
        return false
      }
      if (response._tag === 'RepoNotOpen') {
        toast.error('Repository is not open')
        return false
      }
      toast.error(failedTitle, { description: `Unexpected response: ${response._tag}` })
      return false
    } catch (error) {
      if (!isCurrentRepo(generation, repoPath)) {
        return false
      }
      toastEngineFailure(failedTitle, formatCause(error))
      return false
    }
  }, [])

  const runAction = useCallback<RunAction>(
    (operation, call, label, options) =>
      mutationCoordinator.run(
        operation,
        false,
        () => runActionAttempt(operation, call, label, options),
        notifyBusy
      ),
    [mutationCoordinator.run, runActionAttempt]
  )

  const runPush = async (force?: PushForce, expectedRemoteSha?: string): Promise<PushOutcome> => {
    const repoPath = liveRepoPath.current
    if (!repoPath) {
      toast.error('Repository is not open')
      return { kind: 'error', message: 'Repository is not open' }
    }
    const generation = openGenerationRef.current
    const label = pushLabel(force)
    try {
      const response = await rpcPush(repoPath, force, expectedRemoteSha)
      if (!isCurrentRepo(generation, repoPath)) {
        return { kind: 'error', message: 'Repository changed' }
      }
      if (response._tag === 'Ok') {
        await refreshCaches(repoPath, cachesForOperation(Push._tag))
        toast.success(label)
        return { kind: 'ok' }
      }
      if (response._tag === 'PushRejected') {
        return {
          kind: 'rejected',
          reason: response.reason,
          lostCommits: response.lostCommits,
          remoteSha: response.remoteSha
        }
      }
      if (response._tag === 'RepoNotOpen') {
        toast.error('Repository is not open')
        return { kind: 'error', message: 'Repository is not open' }
      }
      toastGitFailure(`${label} failed`, response.message)
      return { kind: 'error', message: response.message }
    } catch (error) {
      const message = formatCause(error)
      if (!isCurrentRepo(generation, repoPath)) {
        return { kind: 'error', message }
      }
      toastEngineFailure(`${label} failed`, message)
      return { kind: 'error', message }
    }
  }

  const runPull = async (strategy?: PullStrategy): Promise<PullOutcome> => {
    const repoPath = liveRepoPath.current
    if (!repoPath) {
      toast.error('Repository is not open')
      return { kind: 'error', message: 'Repository is not open' }
    }
    const generation = openGenerationRef.current
    try {
      const response = await rpcPull(repoPath, strategy)
      if (!isCurrentRepo(generation, repoPath)) {
        return { kind: 'error', message: 'Repository changed' }
      }
      const decision = decidePullResponse(response)
      if (decision.refreshCaches) {
        await refreshCaches(repoPath, cachesForOperation(Pull._tag))
      }
      showPullNotice(decision.notice)
      return decision.outcome
    } catch (error) {
      const message = formatCause(error)
      if (!isCurrentRepo(generation, repoPath)) {
        return { kind: 'error', message }
      }
      toastEngineFailure('Pull failed', message)
      return { kind: 'error', message }
    }
  }

  const runAmend = async (
    message: string,
    droppedHeadPaths: string[],
    droppedHeadHunks: { file: string; hunks: string[] }[],
    expectedHead: string
  ): Promise<boolean> => {
    const repoPath = liveRepoPath.current
    if (!repoPath) {
      toast.error('Repository is not open')
      return false
    }
    const generation = openGenerationRef.current
    try {
      const response = await rpcAmendCommit(
        repoPath,
        message,
        droppedHeadPaths,
        droppedHeadHunks,
        expectedHead
      )
      if (!isCurrentRepo(generation, repoPath)) {
        return false
      }
      if (
        response._tag === 'Ok' ||
        response._tag === 'AmendRejected' ||
        response._tag === 'HunkNotFound' ||
        response._tag === 'GitError'
      ) {
        await refreshCaches(repoPath, cachesForOperation(AmendCommit._tag))
      }
      if (response._tag === 'Ok') {
        toast.success('Amended')
        return true
      }
      if (response._tag === 'AmendRejected') {
        toast.warning('The last commit moved underneath the amend', {
          description: 'A background fetch or another action advanced HEAD. Refresh and try again.'
        })
        return false
      }
      if (response._tag === 'HunkNotFound') {
        toast.warning('The commit changed since this view loaded', {
          description: 'A dropped hunk no longer matches the last commit. Refresh and try again.'
        })
        return false
      }
      if (response._tag === 'OperationInProgress') {
        toast.warning('Amend blocked', {
          description: `Finish or abort the in-progress ${response.operation} first.`
        })
        return false
      }
      if (response._tag === 'RepoNotOpen') {
        toast.error('Repository is not open')
        return false
      }
      toastGitFailure('Amend failed', response.message)
      return false
    } catch (error) {
      if (!isCurrentRepo(generation, repoPath)) {
        return false
      }
      toastEngineFailure('Amend failed', formatCause(error))
      return false
    }
  }

  const loadHeadMessage = async (): Promise<string | null> => {
    const repoPath = liveRepoPath.current
    if (!repoPath) {
      return null
    }
    try {
      const response = await rpcGetHeadCommit(repoPath)
      return response._tag === 'Ok' ? response.result.message : null
    } catch {
      return null
    }
  }

  const commitMutation = useMutation({
    mutationFn: (message: string) =>
      runActionAttempt(Commit._tag, (repoPath) => rpcCommit(repoPath, message), 'Committed')
  })
  const amendMutation = useMutation({
    mutationFn: (variables: {
      message: string
      droppedHeadPaths: string[]
      droppedHeadHunks: { file: string; hunks: string[] }[]
      expectedHead: string
    }) =>
      runAmend(
        variables.message,
        variables.droppedHeadPaths,
        variables.droppedHeadHunks,
        variables.expectedHead
      )
  })
  const pushMutation = useMutation({
    mutationFn: (variables: { force?: PushForce; expectedRemoteSha?: string }) =>
      runPush(variables.force, variables.expectedRemoteSha)
  })
  const pullMutation = useMutation({
    mutationFn: (variables: { strategy?: PullStrategy }) => runPull(variables.strategy)
  })

  const push = (force?: PushForce, expectedRemoteSha?: string) =>
    mutationCoordinator.run<PushOutcome>(
      Push._tag,
      { kind: 'error', message: 'Another repository action is in progress' },
      () => pushMutation.mutateAsync({ force, expectedRemoteSha }),
      notifyBusy
    )

  const pull = (strategy?: PullStrategy) =>
    mutationCoordinator.run<PullOutcome>(
      Pull._tag,
      { kind: 'error', message: 'Another repository action is in progress' },
      () => pullMutation.mutateAsync({ strategy }),
      notifyBusy
    )

  return {
    runAction,
    commit: (message: string) =>
      mutationCoordinator.run(
        Commit._tag,
        false,
        () => commitMutation.mutateAsync(message),
        notifyBusy
      ),
    amend: (
      message: string,
      droppedHeadPaths: string[],
      droppedHeadHunks: { file: string; hunks: string[] }[],
      expectedHead: string
    ) =>
      mutationCoordinator.run(
        AmendCommit._tag,
        false,
        () =>
          amendMutation.mutateAsync({ message, droppedHeadPaths, droppedHeadHunks, expectedHead }),
        notifyBusy
      ),
    loadHeadMessage,
    push,
    pushNow: () => push().then((outcome) => outcome.kind === 'ok'),
    pull,
    pullNow: () => pull().then((outcome) => outcome.kind === 'ok'),
    committing: mutationCoordinator.activeOperation === Commit._tag,
    amending: mutationCoordinator.activeOperation === AmendCommit._tag,
    pushing: mutationCoordinator.activeOperation === Push._tag,
    pulling: mutationCoordinator.activeOperation === Pull._tag,
    busy: mutationCoordinator.activeOperation !== null
  }
}

const ActionRunnerContext = createContext<ActionRunner | null>(null)

export const ActionRunnerProvider = ActionRunnerContext.Provider

export function useActionRunner(): ActionRunner {
  const value = useContext(ActionRunnerContext)
  if (!value) {
    throw new Error('useActionRunner must be used within a GitStoreProvider')
  }
  return value
}

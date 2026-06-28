import type { LostCommit } from '@shared/git-rpc-errors'
import { AmendCommit, Commit, Pull, Push } from '@shared/rpc'
import { useMutation } from '@tanstack/react-query'
import { createContext, type RefObject, useContext } from 'react'
import { toast } from 'sonner'
import { cachesForOperation, type MappedOperation, type RepoCache } from '@/lib/operation-caches'
import {
  type PushForce,
  rpcAmendCommit,
  rpcCommit,
  rpcGetHeadCommit,
  rpcPull,
  rpcPush
} from '@/lib/rpc-client'

export type PushRejectionReason = 'non-fast-forward' | 'lease-stale' | 'remote-moved'

// The result the push flow drives on: a terminal ok/error is toasted by the runner, while a rejection
// carries the data the split-button dialogs need to advance (the loss preview + the tip to pin).
export type PushOutcome =
  | { kind: 'ok' }
  | {
      kind: 'rejected'
      reason: PushRejectionReason
      lostCommits: readonly LostCommit[]
      remoteSha?: string
    }
  | { kind: 'error'; message: string }

const formatCause = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  return String(error)
}

export type RunAction = (
  operation: MappedOperation,
  call: (repoPath: string) => Promise<{ _tag: string; message?: string }>,
  label: string
) => Promise<boolean>

export interface ActionRunner {
  runAction: RunAction
  commit: (message: string) => Promise<boolean>
  amend: (message: string) => Promise<boolean>
  loadHeadMessage: () => Promise<string | null>
  pushNow: () => Promise<boolean>
  push: (force?: PushForce, expectedRemoteSha?: string) => Promise<PushOutcome>
  pullNow: () => Promise<boolean>
  committing: boolean
  amending: boolean
  pushing: boolean
  pulling: boolean
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
  refreshCaches: (repoPath: string, caches: readonly RepoCache[]) => Promise<unknown>
}

export function useActionRunnerController(deps: ActionRunnerDeps): ActionRunner {
  const { liveRepoPath, refreshCaches } = deps

  // The single action runner: call the typed op, then refresh exactly the caches the op→caches map
  // names — no per-action refresh-bundle choice. Ok toasts success; a Conflict refreshes the same
  // caches but routes to the resolve-the-conflict path (warning, not error). A Git error (or any
  // other non-Ok outcome) toasts and refreshes nothing.
  const runAction: RunAction = async (operation, call, label) => {
    const repoPath = liveRepoPath.current
    if (!repoPath) {
      toast.error('Repository is not open')
      return false
    }
    try {
      const response = await call(repoPath)
      if (response._tag === 'Ok' || response._tag === 'Conflict') {
        await refreshCaches(repoPath, cachesForOperation(operation))
      }
      if (response._tag === 'Ok') {
        toast.success(label)
        return true
      }
      if (response._tag === 'Conflict') {
        toast.warning(`${label} hit conflicts`, {
          description: 'Resolve the conflicted files, then commit or abort.'
        })
        return false
      }
      if (response._tag === 'GitError') {
        toast.error(`${label} failed`, { description: response.message })
        return false
      }
      if (response._tag === 'RepoNotOpen') {
        toast.error('Repository is not open')
        return false
      }
      toast.error(`${label} failed`, { description: `Unexpected response: ${response._tag}` })
      return false
    } catch (error) {
      toast.error(`${label} failed`, { description: formatCause(error) })
      return false
    }
  }

  // Push can't use runAction: a PushRejected is neither a success nor an error to toast — it drives the
  // split-button's two-tier dialog flow. So terminal outcomes (ok/error) toast and refresh here, while
  // a rejection is returned verbatim with its loss preview for the caller to escalate on.
  const runPush = async (force?: PushForce, expectedRemoteSha?: string): Promise<PushOutcome> => {
    const repoPath = liveRepoPath.current
    if (!repoPath) {
      toast.error('Repository is not open')
      return { kind: 'error', message: 'Repository is not open' }
    }
    const label = pushLabel(force)
    try {
      const response = await rpcPush(repoPath, force, expectedRemoteSha)
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
      toast.error(`${label} failed`, { description: response.message })
      return { kind: 'error', message: response.message }
    } catch (error) {
      const message = formatCause(error)
      toast.error(`${label} failed`, { description: message })
      return { kind: 'error', message }
    }
  }

  // Amend can't use runAction either: AmendRejected is an expected CAS refusal (HEAD moved), not an
  // error to toast as a failure — it routes to a refresh-and-retry warning. Ok and the rejection both
  // refresh the same caches so the renderer picks up the moved/rewritten HEAD.
  const runAmend = async (message: string): Promise<boolean> => {
    const repoPath = liveRepoPath.current
    if (!repoPath) {
      toast.error('Repository is not open')
      return false
    }
    try {
      const response = await rpcAmendCommit(repoPath, message)
      if (response._tag === 'Ok' || response._tag === 'AmendRejected') {
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
      if (response._tag === 'RepoNotOpen') {
        toast.error('Repository is not open')
        return false
      }
      toast.error('Amend failed', { description: response.message })
      return false
    } catch (error) {
      toast.error('Amend failed', { description: formatCause(error) })
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
      runAction(Commit._tag, (repoPath) => rpcCommit(repoPath, message), 'Committed')
  })
  const amendMutation = useMutation({ mutationFn: (message: string) => runAmend(message) })
  const pushMutation = useMutation({
    mutationFn: (variables: { force?: PushForce; expectedRemoteSha?: string }) =>
      runPush(variables.force, variables.expectedRemoteSha)
  })
  const pullMutation = useMutation({
    mutationFn: () => runAction(Pull._tag, (repoPath) => rpcPull(repoPath), 'Pulled')
  })

  const push = (force?: PushForce, expectedRemoteSha?: string) =>
    pushMutation.mutateAsync({ force, expectedRemoteSha })

  return {
    runAction,
    commit: (message: string) => commitMutation.mutateAsync(message),
    amend: (message: string) => amendMutation.mutateAsync(message),
    loadHeadMessage,
    push,
    pushNow: () => push().then((outcome) => outcome.kind === 'ok'),
    pullNow: () => pullMutation.mutateAsync(),
    committing: commitMutation.isPending,
    amending: amendMutation.isPending,
    pushing: pushMutation.isPending,
    pulling: pullMutation.isPending
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

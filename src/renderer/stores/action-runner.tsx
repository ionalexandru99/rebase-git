import { Commit, Pull, Push } from '@shared/rpc'
import { useMutation } from '@tanstack/react-query'
import { createContext, type RefObject, useContext } from 'react'
import { toast } from 'sonner'
import { cachesForOperation, type MappedOperation, type RepoCache } from '@/lib/operation-caches'
import { rpcCommit, rpcPull, rpcPush } from '@/lib/rpc-client'

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
  pushNow: () => Promise<boolean>
  pullNow: () => Promise<boolean>
  committing: boolean
  pushing: boolean
  pulling: boolean
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

  const commitMutation = useMutation({
    mutationFn: (message: string) =>
      runAction(Commit._tag, (repoPath) => rpcCommit(repoPath, message), 'Committed')
  })
  const pushMutation = useMutation({
    mutationFn: () => runAction(Push._tag, (repoPath) => rpcPush(repoPath), 'Pushed')
  })
  const pullMutation = useMutation({
    mutationFn: () => runAction(Pull._tag, (repoPath) => rpcPull(repoPath), 'Pulled')
  })

  return {
    runAction,
    commit: (message: string) => commitMutation.mutateAsync(message),
    pushNow: () => pushMutation.mutateAsync(),
    pullNow: () => pullMutation.mutateAsync(),
    committing: commitMutation.isPending,
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

import type { RepoRef } from '@common/features/repository-identity'
import type { QueryClient } from '@tanstack/react-query'
import { repoQueryKeys } from '@/features/repository-identity'
import { formatCause } from '@/lib/format-cause'
import { engineFailureBannerText, gitFailureBannerText } from '@/lib/git-report'
import type { GitStatus } from '@/types'

export type StatusMutationResult =
  | { _tag: 'Ok' }
  | { _tag: 'RepoNotOpen' }
  | { _tag: 'GitError'; message: string }
  | { _tag: 'HunkNotFound' }
  | { _tag: 'OperationInProgress'; operation: string }

export interface StatusMutationContext {
  repository: RepoRef
  path: string
  generation: number
  key: readonly unknown[]
  previous: GitStatus | undefined
  hadOptimistic: boolean
}

interface StatusMutationLifecycleDeps {
  queryClient: QueryClient
  getRepository: () => RepoRef | null
  getGeneration: () => number
  isCurrentRepo: (generation: number, repository: RepoRef) => boolean
  setMutationError: (error: string) => void
  clearMutationError: () => void
}

export function createStatusMutationOptions<Vars>(
  deps: StatusMutationLifecycleDeps,
  applyOptimistic: (current: GitStatus, vars: Vars) => GitStatus | null,
  request: (path: string, vars: Vars) => Promise<StatusMutationResult>
) {
  const resyncStatusAndDiffs = (context: StatusMutationContext) =>
    Promise.all([
      deps.queryClient.invalidateQueries({ queryKey: context.key }),
      deps.queryClient.invalidateQueries({ queryKey: repoQueryKeys(context.repository).diffRoot })
    ])

  return {
    mutationFn: async (vars: Vars): Promise<StatusMutationResult | null> => {
      const repository = deps.getRepository()
      if (!repository) {
        return null
      }
      return request(repository.path, vars)
    },
    onMutate: async (vars: Vars): Promise<StatusMutationContext | undefined> => {
      const repository = deps.getRepository()
      if (!repository) {
        return undefined
      }
      const key = repoQueryKeys(repository).status
      await deps.queryClient.cancelQueries({ queryKey: key })
      const previous = deps.queryClient.getQueryData<GitStatus>(key)
      const optimistic = previous ? applyOptimistic(previous, vars) : null
      if (optimistic) {
        deps.queryClient.setQueryData<GitStatus>(key, optimistic)
      }
      return {
        repository,
        path: repository.path,
        generation: deps.getGeneration(),
        key,
        previous,
        hadOptimistic: Boolean(optimistic)
      }
    },
    onError: (error: unknown, _vars: Vars, context: StatusMutationContext | undefined) => {
      if (context?.hadOptimistic && context.previous) {
        deps.queryClient.setQueryData<GitStatus>(context.key, context.previous)
      }
      if (context && deps.isCurrentRepo(context.generation, context.repository)) {
        deps.setMutationError(engineFailureBannerText('The change did not run', formatCause(error)))
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
        if (deps.isCurrentRepo(context.generation, context.repository)) {
          deps.clearMutationError()
        }
        return resyncStatusAndDiffs(context)
      }
      if (context.hadOptimistic && context.previous) {
        deps.queryClient.setQueryData<GitStatus>(context.key, context.previous)
      }
      if (
        response._tag === 'GitError' &&
        deps.isCurrentRepo(context.generation, context.repository)
      ) {
        deps.setMutationError(gitFailureBannerText('Git rejected the change', response.message))
      }
      if (
        response._tag === 'RepoNotOpen' &&
        deps.isCurrentRepo(context.generation, context.repository)
      ) {
        deps.setMutationError('Repository is not open')
      }
      if (
        response._tag === 'HunkNotFound' &&
        deps.isCurrentRepo(context.generation, context.repository)
      ) {
        deps.setMutationError(
          'The diff changed since this view loaded — it was refreshed. Try again.'
        )
      }
      if (
        response._tag === 'OperationInProgress' &&
        deps.isCurrentRepo(context.generation, context.repository)
      ) {
        deps.setMutationError(`Finish or abort the in-progress ${response.operation} first.`)
      }
      return resyncStatusAndDiffs(context)
    }
  }
}

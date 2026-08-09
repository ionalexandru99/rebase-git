import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { repoQueryKeys, toRepoRef } from '@/features/repository-identity'
import {
  createStatusMutationOptions,
  type StatusMutationContext,
  type StatusMutationResult
} from '@/features/status/status-mutation-lifecycle'
import { makeGitStatus } from '../../../../test/builders'

const repoPath = '/repo'
const statusKey = repoQueryKeys(repoPath).status

function setup(options: { repoPath?: string | null; current?: boolean } = {}) {
  const queryClient = new QueryClient()
  const cancelQueries = vi.spyOn(queryClient, 'cancelQueries').mockResolvedValue(undefined)
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined)
  const setMutationError = vi.fn()
  const clearMutationError = vi.fn()
  const request = vi.fn<(path: string, file: string) => Promise<StatusMutationResult>>()
  request.mockResolvedValue({ _tag: 'Ok' })
  const lifecycle = createStatusMutationOptions(
    {
      queryClient,
      getRepository: () => {
        const path = options.repoPath === undefined ? repoPath : options.repoPath
        return path ? toRepoRef(path) : null
      },
      getGeneration: () => 7,
      isCurrentRepo: () => options.current ?? true,
      setMutationError,
      clearMutationError
    },
    (current, file: string) => ({
      ...current,
      modified: current.modified.filter((entry) => entry !== file),
      staged: [...current.staged, file]
    }),
    request
  )
  return {
    queryClient,
    cancelQueries,
    invalidateQueries,
    setMutationError,
    clearMutationError,
    request,
    lifecycle
  }
}

async function optimisticContext(
  setupResult: ReturnType<typeof setup>
): Promise<StatusMutationContext> {
  setupResult.queryClient.setQueryData(statusKey, makeGitStatus({ modified: ['src/app.ts'] }))
  const context = await setupResult.lifecycle.onMutate('src/app.ts')
  if (!context) {
    throw new Error('expected mutation context')
  }
  return context
}

describe('status mutation lifecycle', () => {
  it('skips requests and optimistic context when no repository is open', async () => {
    const setupResult = setup({ repoPath: null })

    await expect(setupResult.lifecycle.mutationFn('src/app.ts')).resolves.toBeNull()
    await expect(setupResult.lifecycle.onMutate('src/app.ts')).resolves.toBeUndefined()

    expect(setupResult.request).not.toHaveBeenCalled()
    expect(setupResult.cancelQueries).not.toHaveBeenCalled()
  })

  it('captures repository identity and applies cached optimistic status', async () => {
    const setupResult = setup()

    const context = await optimisticContext(setupResult)

    expect(setupResult.cancelQueries).toHaveBeenCalledWith({ queryKey: statusKey })
    expect(context).toMatchObject({ path: repoPath, generation: 7, hadOptimistic: true })
    expect(setupResult.queryClient.getQueryData(statusKey)).toMatchObject({
      modified: [],
      staged: ['src/app.ts']
    })
  })

  it('runs successful mutations against the live path and refreshes status and diffs', async () => {
    const setupResult = setup()
    const context = await optimisticContext(setupResult)

    await expect(setupResult.lifecycle.mutationFn('src/app.ts')).resolves.toEqual({ _tag: 'Ok' })
    await setupResult.lifecycle.onSuccess({ _tag: 'Ok' }, 'src/app.ts', context)

    expect(setupResult.request).toHaveBeenCalledWith(repoPath, 'src/app.ts')
    expect(setupResult.clearMutationError).toHaveBeenCalled()
    expect(setupResult.invalidateQueries).toHaveBeenCalledWith({ queryKey: statusKey })
    expect(setupResult.invalidateQueries).toHaveBeenCalledWith({
      queryKey: repoQueryKeys(repoPath).diffRoot
    })
  })

  it('rolls back optimistic state and reports a Git rejection', async () => {
    const setupResult = setup()
    const context = await optimisticContext(setupResult)

    await setupResult.lifecycle.onSuccess(
      { _tag: 'GitError', message: 'index is locked' },
      'src/app.ts',
      context
    )

    expect(setupResult.queryClient.getQueryData(statusKey)).toMatchObject({
      modified: ['src/app.ts'],
      staged: []
    })
    expect(setupResult.setMutationError).toHaveBeenCalledWith(
      expect.stringContaining('Git rejected the change')
    )
  })

  it.each([
    [{ _tag: 'RepoNotOpen' } as const, 'Repository is not open'],
    [
      { _tag: 'HunkNotFound' } as const,
      'The diff changed since this view loaded — it was refreshed. Try again.'
    ],
    [
      { _tag: 'OperationInProgress', operation: 'rebase' } as const,
      'Finish or abort the in-progress rebase first.'
    ]
  ])('maps %s to its actionable mutation error', async (response, expectedError) => {
    const setupResult = setup()
    const context = await optimisticContext(setupResult)

    await setupResult.lifecycle.onSuccess(response, 'src/app.ts', context)

    expect(setupResult.setMutationError).toHaveBeenCalledWith(expectedError)
  })

  it('rolls back engine failures and reports their cause', async () => {
    const setupResult = setup()
    const context = await optimisticContext(setupResult)

    await setupResult.lifecycle.onError(new Error('sidecar unavailable'), 'src/app.ts', context)

    expect(setupResult.queryClient.getQueryData(statusKey)).toMatchObject({
      modified: ['src/app.ts'],
      staged: []
    })
    expect(setupResult.setMutationError).toHaveBeenCalledWith(
      expect.stringContaining('could not reach the Git engine')
    )
  })

  it('rolls back stale mutations without changing the active repository error', async () => {
    const setupResult = setup({ current: false })
    const context = await optimisticContext(setupResult)

    await setupResult.lifecycle.onSuccess(
      { _tag: 'GitError', message: 'old repository failed' },
      'src/app.ts',
      context
    )

    expect(setupResult.queryClient.getQueryData(statusKey)).toMatchObject({
      modified: ['src/app.ts'],
      staged: []
    })
    expect(setupResult.setMutationError).not.toHaveBeenCalled()
  })
})

import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { repoQueryKeys } from '@/features/repository-identity'
import { statusResponse } from '../../../test/builders'
import { setupRepoChanged, sidecarMock } from '../../../test/setup'
import { prepareGitStoreMocks, renderGitStore, repoPath, statusOk } from './git-store-harness'

describe('GitStoreProvider — working-tree mutations and status state', () => {
  beforeEach(() => {
    prepareGitStoreMocks()
  })
  it('discards an out-of-order status response that resolves after a newer one', async () => {
    const partialStatus = statusResponse({
      modified: ['a.ts'],
      staged: ['a.ts'],
      files: [{ path: 'a.ts', index: 'M', working_dir: 'M' }]
    })
    const stagedStatus = statusResponse({
      staged: ['a.ts'],
      files: [{ path: 'a.ts', index: 'M', working_dir: ' ' }]
    })

    const repoChanged = setupRepoChanged()
    sidecarMock.stageHunk.mockResolvedValue({ _tag: 'Ok' })

    const { git } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => {
      expect(git.state.status).not.toBeNull()
    })

    let resolveStale: () => void = () => {}
    sidecarMock.getStatus
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveStale = () => resolve(partialStatus)
          })
      )
      .mockResolvedValue(stagedStatus)

    repoChanged.fire({ repoPath, kind: 'workingTree' })
    await git.stageHunk('a.ts', '@@ -1,1 +1,1 @@')

    await waitFor(() => {
      expect(git.state.status?.files?.[0]).toEqual({
        path: 'a.ts',
        index: 'M',
        working_dir: ' '
      })
    })

    await act(async () => {
      resolveStale()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(git.state.status?.files?.[0]).toEqual({
      path: 'a.ts',
      index: 'M',
      working_dir: ' '
    })
  })

  it('optimistically marks a file staged when staging its final hunk', async () => {
    const partialStatus = statusResponse({
      modified: ['a.ts'],
      staged: ['a.ts'],
      files: [{ path: 'a.ts', index: 'M', working_dir: 'M' }]
    })
    const stagedStatus = statusResponse({
      staged: ['a.ts'],
      files: [{ path: 'a.ts', index: 'M', working_dir: ' ' }]
    })
    let resolveStageHunk: () => void = () => {}

    sidecarMock.getStatus.mockResolvedValueOnce(partialStatus).mockResolvedValue(stagedStatus)
    sidecarMock.stageHunk.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStageHunk = () => resolve({ _tag: 'Ok' })
        })
    )

    const { git, startGitCall } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => {
      expect(git.state.status?.files?.[0]).toEqual({
        path: 'a.ts',
        index: 'M',
        working_dir: 'M'
      })
    })

    const stagePromise = startGitCall((current) =>
      current.stageHunk('a.ts', '@@ -1,1 +1,1 @@', { fullyStagesFile: true })
    )

    await waitFor(() => {
      expect(git.state.status?.files?.[0]).toEqual({
        path: 'a.ts',
        index: 'M',
        working_dir: ' '
      })
    })
    expect(git.state.status?.modified).toEqual([])
    expect(git.state.status?.staged).toEqual(['a.ts'])

    await act(async () => {
      resolveStageHunk()
      await stagePromise
    })

    expect(git.state.status?.files?.[0]).toEqual({
      path: 'a.ts',
      index: 'M',
      working_dir: ' '
    })
  })

  it('stageFile optimistically stages then confirms from the sidecar', async () => {
    const modifiedStatus = statusResponse({
      modified: ['a.ts'],
      files: [{ path: 'a.ts', index: ' ', working_dir: 'M' }]
    })
    const stagedStatus = statusResponse({
      staged: ['a.ts'],
      files: [{ path: 'a.ts', index: 'M', working_dir: ' ' }]
    })
    sidecarMock.getStatus.mockResolvedValueOnce(modifiedStatus).mockResolvedValue(stagedStatus)
    let resolveStage: () => void = () => {}
    sidecarMock.stageFile.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStage = () => resolve({ _tag: 'Ok' })
        })
    )

    const { git, startGitCall } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => {
      expect(git.state.status?.files?.[0]).toEqual({ path: 'a.ts', index: ' ', working_dir: 'M' })
    })

    const stagePromise = startGitCall((current) => current.stageFile('a.ts'))

    await waitFor(() => {
      expect(git.state.status?.staged).toEqual(['a.ts'])
      expect(git.state.status?.modified).toEqual([])
    })

    await act(async () => {
      resolveStage()
      await stagePromise
    })
    await waitFor(() => {
      expect(git.state.status?.files?.[0]).toEqual({ path: 'a.ts', index: 'M', working_dir: ' ' })
    })
  })

  it('does not start a stash mutation while staging is in flight', async () => {
    let resolveStage: () => void = () => {}
    sidecarMock.stageFile.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStage = () => resolve({ _tag: 'Ok' })
        })
    )
    const stashCall = vi.fn().mockResolvedValue({ _tag: 'Ok' })
    const { git, startGitCall } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => expect(git.state.repoPath).toBe(repoPath))

    const stagePromise = startGitCall((current) => current.stageFile('a.ts'))
    await waitFor(() => expect(sidecarMock.stageFile).toHaveBeenCalled())
    const stashed = await git.runAction('stashPush', stashCall, 'Stashed changes')

    expect(stashed).toBe(false)
    expect(stashCall).not.toHaveBeenCalled()
    await act(async () => {
      resolveStage()
      await stagePromise
    })
  })

  it('rolls the optimistic stage back when the sidecar rejects it', async () => {
    const modifiedStatus = statusResponse({
      modified: ['a.ts'],
      files: [{ path: 'a.ts', index: ' ', working_dir: 'M' }]
    })
    sidecarMock.getStatus.mockResolvedValue(modifiedStatus)
    sidecarMock.stageFile.mockResolvedValue({ _tag: 'GitError', message: 'cannot stage' })

    const { git } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => {
      expect(git.state.status?.modified).toEqual(['a.ts'])
    })

    await git.stageFile('a.ts')

    await waitFor(() => {
      expect(git.state.error).toBe(
        `Git rejected the change: Git rejected the operation. The full output is in the developer console.`
      )
    })
    expect(git.state.status?.staged).toEqual([])
    expect(git.state.status?.modified).toEqual(['a.ts'])
  })

  it('clears a mutation error banner after a later mutation succeeds', async () => {
    const modifiedStatus = statusResponse({
      modified: ['a.ts'],
      files: [{ path: 'a.ts', index: ' ', working_dir: 'M' }]
    })
    sidecarMock.getStatus.mockResolvedValue(modifiedStatus)
    sidecarMock.stageFile
      .mockResolvedValueOnce({ _tag: 'GitError', message: 'cannot stage' })
      .mockResolvedValueOnce({ _tag: 'Ok' })

    const { git } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => {
      expect(git.state.status?.modified).toEqual(['a.ts'])
    })

    await git.stageFile('a.ts')
    await waitFor(() => {
      expect(git.state.error).toBe(
        `Git rejected the change: Git rejected the operation. The full output is in the developer console.`
      )
    })

    await git.stageFile('a.ts')

    await waitFor(() => {
      expect(git.state.error).toBeNull()
    })
  })

  it('clears a status error banner after a later status refresh succeeds', async () => {
    const repoChanged = setupRepoChanged()
    sidecarMock.getStatus.mockResolvedValueOnce({ _tag: 'GitError', message: 'index.lock exists' })
    const { git } = renderGitStore()

    await git.openRepo(repoPath)
    await waitFor(() => {
      expect(git.state.error).toContain('Another Git process holds this repository')
    })

    sidecarMock.getStatus.mockResolvedValue(statusOk)
    repoChanged.fire({ repoPath, kind: 'workingTree' })

    await waitFor(() => {
      expect(git.state.status).not.toBeNull()
      expect(git.state.error).toBeNull()
    })
  })

  it('re-syncs status after a failed hunk op (stale diff)', async () => {
    sidecarMock.stageHunk.mockResolvedValue({ _tag: 'GitError', message: 'hunk gone' })

    const { git } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => {
      expect(git.state.status).not.toBeNull()
    })

    sidecarMock.getStatus.mockClear()
    const ok = await git.stageHunk('a.ts', '@@ -1,1 +1,1 @@')

    expect(ok).toBe(false)
    await waitFor(() => {
      expect(sidecarMock.getStatus).toHaveBeenCalledWith(repoPath)
    })
    expect(git.state.error).toBe(
      `Git rejected the change: Git rejected the operation. The full output is in the developer console.`
    )
  })

  it('maps a stale line selection (HunkNotFound) to a stale-view banner and re-syncs', async () => {
    sidecarMock.stageLines.mockResolvedValue({ _tag: 'HunkNotFound' })

    const { git } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => {
      expect(git.state.status).not.toBeNull()
    })

    sidecarMock.getStatus.mockClear()
    const ok = await git.stageLines('a.ts', [
      { hunkHeader: '@@ -1,1 +1,1 @@', lineIndexes: [0], fingerprint: 'deadbeef' }
    ])

    expect(ok).toBe(false)
    await waitFor(() => {
      expect(sidecarMock.getStatus).toHaveBeenCalledWith(repoPath)
    })
    expect(git.state.error).toBe(
      'The diff changed since this view loaded — it was refreshed. Try again.'
    )
  })

  it('reads server state from the query cache (cache is the source of truth)', async () => {
    const { git, queryClient } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => {
      expect(git.state.repoPath).toBe(repoPath)
    })

    const before = git.state
    act(() => {
      queryClient.setQueryData(repoQueryKeys(repoPath).status, {
        ...statusOk.status,
        modified: ['only-in-cache.ts']
      })
    })

    await waitFor(() => {
      expect(git.state.status?.modified).toEqual(['only-in-cache.ts'])
    })
    expect(git.state).not.toBe(before)
    expect(queryClient.getQueryData(repoQueryKeys(repoPath).status)).toBe(git.state.status)
  })

  it('repaints from the warm cache when a repo is closed and reopened', async () => {
    const { git } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => {
      expect(git.state.status).not.toBeNull()
      expect(git.state.branches?.all).toEqual(['main', 'dev'])
    })

    await git.closeRepo()
    await waitFor(() => {
      expect(git.state.repoPath).toBeNull()
    })

    sidecarMock.getStatus.mockImplementation(() => new Promise(() => {}))
    sidecarMock.getLocalBranches.mockImplementation(() => new Promise(() => {}))
    await git.openRepo(repoPath)

    await waitFor(() => {
      expect(git.state.repoPath).toBe(repoPath)
      expect(git.state.status).not.toBeNull()
      expect(git.state.branches?.all).toEqual(['main', 'dev'])
    })
  })

  it('rolls back and surfaces the error when staging throws', async () => {
    const modifiedStatus = statusResponse({
      modified: ['a.ts'],
      files: [{ path: 'a.ts', index: ' ', working_dir: 'M' }]
    })
    sidecarMock.getStatus.mockResolvedValue(modifiedStatus)
    let rejectStage: (error: Error) => void = () => {}
    sidecarMock.stageFile.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectStage = reject
        })
    )

    const { git, startGitCall } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => {
      expect(git.state.status?.modified).toEqual(['a.ts'])
    })

    const stagePromise = startGitCall((current) => current.stageFile('a.ts'))
    await waitFor(() => expect(sidecarMock.stageFile).toHaveBeenCalledWith(repoPath, 'a.ts'))
    await act(async () => {
      rejectStage(new Error('network down'))
      await stagePromise.catch(() => {})
    })

    await waitFor(() => {
      expect(git.state.error).toBe(
        'The change did not run: Rebase could not reach the Git engine — it may have restarted. Try again; the error is in the developer console.'
      )
    })
    expect(git.state.status?.staged).toEqual([])
    expect(git.state.status?.modified).toEqual(['a.ts'])
  })
})

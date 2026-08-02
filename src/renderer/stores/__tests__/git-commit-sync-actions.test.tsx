// biome-ignore assist/source/organizeImports: Vitest requires the toast mock import first.
import { getGitStoreToast } from './git-store-toast'
import { PULL_REAPPLY_CONFLICTS_MESSAGE } from '@shared/git-constants'
import { AmendCommit } from '@shared/rpc'
import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sidecarMock } from '../../../test/setup'
import {
  openRepoOkFor,
  otherRepoPath,
  prepareGitStoreMocks,
  renderGitStore,
  repoPath
} from './git-store-harness'

const toast = getGitStoreToast()

describe('GitStoreProvider — commit, push, and pull synchronization', () => {
  beforeEach(() => {
    prepareGitStoreMocks()
  })
  it('commit refreshes status and restarts the log stream on success', async () => {
    sidecarMock.commit.mockResolvedValue({
      _tag: 'Ok',
      result: {
        commit: 'abc1234',
        branch: 'main',
        summary: { changes: 1, insertions: 1, deletions: 0 }
      }
    })

    const { git } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => {
      expect(git.state.repoPath).toBe(repoPath)
    })

    sidecarMock.getStatus.mockClear()
    sidecarMock.getLocalBranches.mockClear()
    vi.mocked(window.electronAPI.startLogStream).mockClear()
    const committed = await git.commit('a message')

    expect(committed).toBe(true)
    expect(sidecarMock.commit).toHaveBeenCalledWith(repoPath, 'a message')
    expect(sidecarMock.getStatus).toHaveBeenCalledWith(repoPath)
    expect(sidecarMock.getLocalBranches).toHaveBeenCalledWith(repoPath)
    expect(window.electronAPI.startLogStream).toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith('Committed')
    expect(git.state.committing).toBe(false)
  })

  it('amend maps OperationInProgress to a finish-or-abort warning and reports failure', async () => {
    sidecarMock.respond(AmendCommit, () => ({
      _tag: 'OperationInProgress',
      operation: 'merge'
    }))

    const { git } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => {
      expect(git.state.repoPath).toBe(repoPath)
    })

    const amended = await git.amend('rewritten message', [], [], 'headsha123')

    expect(amended).toBe(false)
    expect(toast.warning).toHaveBeenCalledWith('Amend blocked', {
      description: 'Finish or abort the in-progress merge first.'
    })
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('amend forwards the expectedHead sha the UI rendered against into the RPC payload', async () => {
    let amendBody: Record<string, unknown> | undefined
    sidecarMock.respond(AmendCommit, (body) => {
      amendBody = body
      return {
        _tag: 'Ok',
        result: {
          commit: 'def5678',
          branch: 'main',
          summary: { changes: 1, insertions: 1, deletions: 0 }
        }
      }
    })

    const { git } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => {
      expect(git.state.repoPath).toBe(repoPath)
    })

    const amended = await git.amend('rewritten message', [], [], 'headsha123')

    expect(amended).toBe(true)
    expect(amendBody?.expectedHead).toBe('headsha123')
  })

  it('amend refreshes the repo caches even when it fails with a GitError', async () => {
    sidecarMock.respond(AmendCommit, () => ({ _tag: 'GitError', message: 'index locked' }))

    const { git } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => {
      expect(git.state.repoPath).toBe(repoPath)
    })

    sidecarMock.getStatus.mockClear()
    sidecarMock.getLocalBranches.mockClear()
    vi.mocked(window.electronAPI.startLogStream).mockClear()

    const amended = await git.amend('rewritten message', [], [], 'headsha123')

    expect(amended).toBe(false)
    expect(toast.error).toHaveBeenCalledWith('Amend failed', {
      description: 'Git rejected the operation. The full output is in the developer console.'
    })
    expect(sidecarMock.getStatus).toHaveBeenCalledWith(repoPath)
    expect(sidecarMock.getLocalBranches).toHaveBeenCalledWith(repoPath)
    expect(window.electronAPI.startLogStream).toHaveBeenCalled()
  })

  it('amend maps HunkNotFound to a stale-view warning and refreshes the caches', async () => {
    sidecarMock.respond(AmendCommit, () => ({ _tag: 'HunkNotFound' }))

    const { git } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => {
      expect(git.state.repoPath).toBe(repoPath)
    })

    sidecarMock.getStatus.mockClear()
    const amended = await git.amend('rewritten message', [], [], 'headsha123')

    expect(amended).toBe(false)
    expect(toast.warning).toHaveBeenCalledWith('The commit changed since this view loaded', {
      description: 'A dropped hunk no longer matches the last commit. Refresh and try again.'
    })
    expect(sidecarMock.getStatus).toHaveBeenCalledWith(repoPath)
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('pushNow refreshes branches and history and clears the pushing flag on success', async () => {
    sidecarMock.pushRepo.mockResolvedValue({ _tag: 'Ok' })
    const { git } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => expect(git.state.repoPath).toBe(repoPath))

    sidecarMock.getLocalBranches.mockClear()
    vi.mocked(window.electronAPI.startLogStream).mockClear()
    await git.pushNow()

    expect(sidecarMock.pushRepo).toHaveBeenCalledWith(repoPath)
    expect(sidecarMock.getLocalBranches).toHaveBeenCalledWith(repoPath)
    expect(window.electronAPI.startLogStream).toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith('Pushed')
    expect(git.state.pushing).toBe(false)
    expect(git.state.error).toBeNull()
  })

  it('reflects only the in-flight action’s pending flag', async () => {
    let resolvePush: () => void = () => {}
    sidecarMock.pushRepo.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePush = () => resolve({ _tag: 'Ok' })
        })
    )
    const { git, startGitCall } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => expect(git.state.repoPath).toBe(repoPath))

    const pushPromise = startGitCall((current) => current.pushNow())
    await waitFor(() => expect(git.state.pushing).toBe(true))
    expect(git.state.committing).toBe(false)
    expect(git.state.pulling).toBe(false)

    await act(async () => {
      resolvePush()
      await pushPromise
    })
    await waitFor(() => expect(git.state.pushing).toBe(false))
  })

  it('does not queue a commit while a push is already in flight', async () => {
    let resolvePush: () => void = () => {}
    sidecarMock.pushRepo.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePush = () => resolve({ _tag: 'Ok' })
        })
    )
    sidecarMock.commit.mockResolvedValue({
      _tag: 'Ok',
      result: {
        commit: 'abc1234',
        branch: 'main',
        summary: { changes: 1, insertions: 1, deletions: 0 }
      }
    })
    const { git, startGitCall } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => expect(git.state.repoPath).toBe(repoPath))

    const pushPromise = startGitCall((current) => current.pushNow())
    const committed = await git.commit('must not queue')

    expect(committed).toBe(false)
    expect(sidecarMock.commit).not.toHaveBeenCalled()
    await act(async () => {
      resolvePush()
      await pushPromise
    })
  })

  it('pushNow toasts a GitError without touching session error', async () => {
    sidecarMock.pushRepo.mockResolvedValue({
      _tag: 'GitError',
      message: 'no upstream'
    })
    const { git } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => expect(git.state.repoPath).toBe(repoPath))

    await git.pushNow()

    expect(toast.error).toHaveBeenCalledWith('Push failed', {
      description: 'Git rejected the operation. The full output is in the developer console.'
    })
    expect(git.state.error).toBeNull()
    expect(git.state.pushing).toBe(false)
  })

  it('pushNow explains a push blocked by unconfigured auth and logs git verbatim', async () => {
    const raw = 'git@github.com: Permission denied (publickey).'
    sidecarMock.pushRepo.mockResolvedValue({ _tag: 'GitError', message: raw })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { git } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => expect(git.state.repoPath).toBe(repoPath))

    await git.pushNow()

    expect(toast.error).toHaveBeenCalledWith(
      'Push failed',
      expect.objectContaining({
        description: expect.stringContaining('github.com refused your SSH key')
      })
    )
    expect(logged).toHaveBeenCalledWith('[git] Push failed:', raw)
    logged.mockRestore()
  })

  it('says so instead of dropping a push that lands while another action runs', async () => {
    let resolveCommit: () => void = () => {}
    sidecarMock.commit.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCommit = () =>
            resolve({
              _tag: 'Ok',
              result: {
                commit: 'abc1234',
                branch: 'main',
                summary: { changes: 1, insertions: 1, deletions: 0 }
              }
            })
        })
    )
    const { git, startGitCall } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => expect(git.state.repoPath).toBe(repoPath))

    const commitPromise = startGitCall((current) => current.commit('slow commit'))
    const pushed = await git.pushNow()

    expect(pushed).toBe(false)
    expect(sidecarMock.pushRepo).not.toHaveBeenCalled()
    expect(toast.info).toHaveBeenCalledWith(
      'Another Git action is still running',
      expect.objectContaining({ description: expect.any(String) })
    )
    await act(async () => {
      resolveCommit()
      await commitPromise
    })
  })

  it('ignores a stale push error after switching repos', async () => {
    vi.mocked(window.electronAPI.openRepo).mockImplementation((requestedPath) =>
      Promise.resolve(openRepoOkFor(requestedPath))
    )
    let resolvePush: () => void = () => {}
    sidecarMock.pushRepo.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePush = () => resolve({ _tag: 'GitError', message: 'old push failed' })
        })
    )

    const { git, session, startGitCall } = renderGitStore()
    await session.openRepo(repoPath)
    await waitFor(() => expect(session.repoPath).toBe(repoPath))

    const pushPromise = startGitCall((current) => current.pushNow())
    await waitFor(() => {
      expect(git.state.pushing).toBe(true)
    })
    await session.openRepo(otherRepoPath)

    await act(async () => {
      resolvePush()
      await pushPromise
    })

    expect(session.repoPath).toBe(otherRepoPath)
    expect(session.error).toBeNull()
    expect(toast.error).not.toHaveBeenCalledWith(
      'Push failed',
      expect.objectContaining({ description: expect.any(String) })
    )
    await session.closeRepo()
  })

  it('pullNow refreshes status and restarts the log stream on success', async () => {
    sidecarMock.pullRepo.mockResolvedValue({ _tag: 'Ok' })
    const { git } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => expect(git.state.repoPath).toBe(repoPath))

    sidecarMock.getStatus.mockClear()
    vi.mocked(window.electronAPI.startLogStream).mockClear()
    await git.pullNow()

    expect(sidecarMock.pullRepo).toHaveBeenCalledWith(repoPath)
    expect(sidecarMock.getStatus).toHaveBeenCalledWith(repoPath)
    expect(window.electronAPI.startLogStream).toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith('Pulled')
    expect(git.state.pulling).toBe(false)
    expect(git.state.error).toBeNull()
  })

  it('pull reports divergence silently so the caller can offer a strategy', async () => {
    sidecarMock.pullRepo.mockResolvedValue({ _tag: 'PullDiverged' })
    const { git } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => expect(git.state.repoPath).toBe(repoPath))

    sidecarMock.getStatus.mockClear()
    const outcome = await git.pull()

    expect(outcome).toEqual({ kind: 'diverged' })
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.warning).not.toHaveBeenCalled()
    expect(sidecarMock.getStatus).not.toHaveBeenCalled()
  })

  it('pull forwards the chosen strategy to the sidecar and toasts success', async () => {
    sidecarMock.pullRepo.mockResolvedValue({ _tag: 'Ok' })
    const { git } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => expect(git.state.repoPath).toBe(repoPath))

    const outcome = await git.pull('rebase')

    expect(sidecarMock.pullRepo).toHaveBeenCalledWith(repoPath, 'rebase')
    expect(outcome).toEqual({ kind: 'ok' })
    expect(toast.success).toHaveBeenCalledWith('Pulled')
  })

  it('pull lands a conflicted strategy pull in the conflict flow with fresh caches', async () => {
    sidecarMock.pullRepo.mockResolvedValue({ _tag: 'Conflict', message: 'CONFLICT in a.txt' })
    const { git } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => expect(git.state.repoPath).toBe(repoPath))

    sidecarMock.getStatus.mockClear()
    const outcome = await git.pull('merge')

    expect(outcome).toEqual({ kind: 'conflict' })
    expect(toast.warning).toHaveBeenCalledWith('Pull hit conflicts', {
      description: 'Resolve the conflicted files, then continue or abort.'
    })
    expect(sidecarMock.getStatus).toHaveBeenCalledWith(repoPath)
  })

  it('pull explains the kept stash when reapplying uncommitted changes conflicted', async () => {
    sidecarMock.pullRepo.mockResolvedValue({
      _tag: 'Conflict',
      message: PULL_REAPPLY_CONFLICTS_MESSAGE
    })
    const { git } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => expect(git.state.repoPath).toBe(repoPath))

    sidecarMock.getStatus.mockClear()
    const outcome = await git.pull()

    expect(outcome).toEqual({ kind: 'conflict' })
    expect(toast.warning).toHaveBeenCalledWith('Pulled, but your uncommitted changes conflicted', {
      description:
        'Resolve the conflicted files, then drop the kept stash — your original changes are safe in it.'
    })
    expect(sidecarMock.getStatus).toHaveBeenCalledWith(repoPath)
  })

  it('pull warns and reports an error when another operation is already in progress', async () => {
    sidecarMock.pullRepo.mockResolvedValue({ _tag: 'OperationInProgress', operation: 'merge' })
    const { git } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => expect(git.state.repoPath).toBe(repoPath))

    const outcome = await git.pull('rebase')

    expect(outcome.kind).toBe('error')
    expect(toast.warning).toHaveBeenCalledWith('Another Git operation is in progress', {
      description: 'Finish or abort the in-progress merge first.'
    })
  })

  it('pullNow toasts a GitError without touching session error', async () => {
    sidecarMock.pullRepo.mockResolvedValue({
      _tag: 'GitError',
      message: 'not fast-forward'
    })
    const { git } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => expect(git.state.repoPath).toBe(repoPath))

    await git.pullNow()

    expect(toast.error).toHaveBeenCalledWith('Pull failed', {
      description: 'Git rejected the operation. The full output is in the developer console.'
    })
    expect(git.state.error).toBeNull()
    expect(git.state.pulling).toBe(false)
  })
})

// biome-ignore assist/source/organizeImports: Vitest requires the toast mock import first.
import { getGitStoreToast } from './git-store-toast'
import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useStashes } from '@/hooks/git/useStashes'
import { GitStoreProvider, useRepoSession } from '@/stores/git'
import { renderWithQuery } from '../../../test/render-app'
import { sidecarMock } from '../../../test/setup'
import {
  type AggregateGit,
  prepareGitStoreMocks,
  renderGitStore,
  repoPath,
  useAggregateGit
} from './git-store-harness'

const toast = getGitStoreToast()

describe('GitStoreProvider — generic actions and stash caches', () => {
  beforeEach(() => {
    prepareGitStoreMocks({ stashes: true })
  })
  function StashProbe(props: { onGit: (git: AggregateGit) => void }) {
    const git = useAggregateGit()
    const session = useRepoSession()
    useStashes(session.repoPath)
    props.onGit(git)
    return null
  }

  function StashHarness(props: { onGit: (git: AggregateGit) => void }) {
    return (
      <GitStoreProvider tabId="test-tab" tabActive={true}>
        <StashProbe {...props} />
      </GitStoreProvider>
    )
  }
  async function openedStore() {
    const { git } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => {
      expect(git.state.repoPath).toBe(repoPath)
      expect(sidecarMock.getLocalBranches).toHaveBeenCalledWith(repoPath)
      expect(sidecarMock.getRemoteRefs).toHaveBeenCalledWith(repoPath)
    })
    sidecarMock.getStatus.mockClear()
    sidecarMock.getLocalBranches.mockClear()
    sidecarMock.getRemoteRefs.mockClear()
    return git
  }
  it('invalidates exactly the mapped caches and toasts success on Ok', async () => {
    const git = await openedStore()

    const call = vi.fn().mockResolvedValue({ _tag: 'Ok' })
    const ok = await git.runAction('deleteBranch', call, 'Deleted branch feature')

    expect(ok).toBe(true)
    expect(call).toHaveBeenCalledWith(repoPath)
    expect(toast.success).toHaveBeenCalledWith('Deleted branch feature')
    await waitFor(() => {
      expect(sidecarMock.getLocalBranches).toHaveBeenCalledWith(repoPath)
      expect(sidecarMock.getRemoteRefs).toHaveBeenCalledWith(repoPath)
    })
    expect(sidecarMock.getStatus).not.toHaveBeenCalled()
  })

  it('stays silent on success for a silentSuccess action but still refreshes and still reports errors', async () => {
    const git = await openedStore()

    const ok = await git.runAction(
      'resolveConflict',
      vi.fn().mockResolvedValue({ _tag: 'Ok' }),
      'Resolve src/a.ts',
      { silentSuccess: true }
    )

    expect(ok).toBe(true)
    expect(toast.success).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(sidecarMock.getStatus).toHaveBeenCalledWith(repoPath)
    })

    const failed = await git.runAction(
      'resolveConflict',
      vi.fn().mockResolvedValue({ _tag: 'GitError', message: 'no conflict to resolve' }),
      'Resolve src/a.ts',
      { silentSuccess: true }
    )

    expect(failed).toBe(false)
    expect(toast.error).toHaveBeenCalledWith('Resolve src/a.ts failed', {
      description: 'Git rejected the operation. The full output is in the developer console.'
    })
  })

  it('toasts the failure and invalidates nothing on a Git error', async () => {
    const git = await openedStore()

    const call = vi.fn().mockResolvedValue({ _tag: 'GitError', message: 'branch not found' })
    const ok = await git.runAction('deleteBranch', call, 'Deleted branch feature')

    expect(ok).toBe(false)
    expect(toast.error).toHaveBeenCalledWith('Deleted branch feature failed', {
      description: 'Git rejected the operation. The full output is in the developer console.'
    })
    expect(toast.success).not.toHaveBeenCalled()
    expect(sidecarMock.getLocalBranches).not.toHaveBeenCalled()
    expect(sidecarMock.getRemoteRefs).not.toHaveBeenCalled()
    expect(sidecarMock.getStatus).not.toHaveBeenCalled()
  })

  it('reports a RepoNotOpen response as repo-not-open and invalidates nothing', async () => {
    const git = await openedStore()

    const call = vi.fn().mockResolvedValue({ _tag: 'RepoNotOpen' })
    const ok = await git.runAction('deleteBranch', call, 'Deleted branch feature')

    expect(ok).toBe(false)
    expect(toast.error).toHaveBeenCalledWith('Repository is not open')
    expect(sidecarMock.getLocalBranches).not.toHaveBeenCalled()
    expect(sidecarMock.getRemoteRefs).not.toHaveBeenCalled()
  })

  it('reports a closed repo and never calls the op when no repo is open', async () => {
    const { git } = renderGitStore()

    const call = vi.fn().mockResolvedValue({ _tag: 'Ok' })
    const ok = await git.runAction('deleteBranch', call, 'Deleted branch feature')

    expect(ok).toBe(false)
    expect(call).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('Repository is not open')
  })

  it('routes a conflictable op Conflict to the resolve path and refreshes its mapped caches', async () => {
    const git = await openedStore()
    vi.mocked(window.electronAPI.startLogStream).mockClear()

    const call = vi.fn().mockResolvedValue({ _tag: 'Conflict', message: 'merge stopped' })
    const ok = await git.runAction('mergeBranch', call, 'Merged feature')

    expect(ok).toBe(false)
    expect(toast.warning).toHaveBeenCalledWith('Merged feature hit conflicts', {
      description: 'Resolve the conflicted files, then commit or abort.'
    })
    expect(toast.error).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(sidecarMock.getStatus).toHaveBeenCalledWith(repoPath)
      expect(sidecarMock.getLocalBranches).toHaveBeenCalledWith(repoPath)
      expect(sidecarMock.getRemoteRefs).toHaveBeenCalledWith(repoPath)
    })
    expect(window.electronAPI.startLogStream).toHaveBeenCalled()
  })

  it('names the operation standing in the way when one is already in progress', async () => {
    const git = await openedStore()

    const call = vi
      .fn()
      .mockResolvedValue({ _tag: 'OperationInProgress', operation: 'cherry-pick' })
    const ok = await git.runAction('mergeBranch', call, 'Merged feature')

    expect(ok).toBe(false)
    expect(toast.warning).toHaveBeenCalledWith('Another Git operation is in progress', {
      description: 'Finish or abort the in-progress cherry-pick first.'
    })
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('prefers the caller conflict guidance over the commit-or-abort default', async () => {
    const git = await openedStore()

    const call = vi.fn().mockResolvedValue({ _tag: 'Conflict', message: 'rebase stopped' })
    const ok = await git.runAction('continueOperation', call, 'Continued rebase', {
      conflictDescription:
        'Resolve and stage the conflicted files, then finish from the conflict banner.'
    })

    expect(ok).toBe(false)
    expect(toast.warning).toHaveBeenCalledWith('Continued rebase hit conflicts', {
      description: 'Resolve and stage the conflicted files, then finish from the conflict banner.'
    })
  })

  it('refreshes only branches for a plain create-branch — not the working tree or timeline', async () => {
    const git = await openedStore()
    vi.mocked(window.electronAPI.startLogStream).mockClear()

    const call = vi.fn().mockResolvedValue({ _tag: 'Ok' })
    const ok = await git.runAction('createBranch', call, 'Created branch feature')

    expect(ok).toBe(true)
    await waitFor(() => {
      expect(sidecarMock.getLocalBranches).toHaveBeenCalledWith(repoPath)
      expect(sidecarMock.getRemoteRefs).toHaveBeenCalledWith(repoPath)
    })
    expect(sidecarMock.getStatus).not.toHaveBeenCalled()
    expect(window.electronAPI.startLogStream).not.toHaveBeenCalled()
  })

  it('refreshes the working tree, branches, and timeline for a create+checkout', async () => {
    const git = await openedStore()
    vi.mocked(window.electronAPI.startLogStream).mockClear()

    const call = vi.fn().mockResolvedValue({ _tag: 'Ok' })
    const ok = await git.runAction('createBranchCheckout', call, 'Created and switched to feature')

    expect(ok).toBe(true)
    await waitFor(() => {
      expect(sidecarMock.getStatus).toHaveBeenCalledWith(repoPath)
      expect(sidecarMock.getLocalBranches).toHaveBeenCalledWith(repoPath)
      expect(sidecarMock.getRemoteRefs).toHaveBeenCalledWith(repoPath)
    })
    expect(window.electronAPI.startLogStream).toHaveBeenCalled()
  })

  it('refreshes only the working tree for a discard — not branches or the timeline', async () => {
    const git = await openedStore()
    vi.mocked(window.electronAPI.startLogStream).mockClear()

    const call = vi.fn().mockResolvedValue({ _tag: 'Ok' })
    const ok = await git.runAction('discardChanges', call, 'Discarded changes')

    expect(ok).toBe(true)
    await waitFor(() => {
      expect(sidecarMock.getStatus).toHaveBeenCalledWith(repoPath)
    })
    expect(sidecarMock.getLocalBranches).not.toHaveBeenCalled()
    expect(sidecarMock.getRemoteRefs).not.toHaveBeenCalled()
    expect(window.electronAPI.startLogStream).not.toHaveBeenCalled()
  })
  async function openedStashStore() {
    const ref: { git?: AggregateGit } = {}
    renderWithQuery(() => <StashHarness onGit={(git) => (ref.git = git)} />)
    await act(async () => {
      await ref.git?.openRepo(repoPath)
    })
    await waitFor(() => {
      expect(sidecarMock.stashList).toHaveBeenCalledWith(repoPath)
    })
    sidecarMock.getStatus.mockClear()
    sidecarMock.getLocalBranches.mockClear()
    sidecarMock.getRemoteRefs.mockClear()
    vi.mocked(window.electronAPI.startLogStream).mockClear()
    return ref
  }
  it('refreshes only the stash list for a stash drop', async () => {
    const ref = await openedStashStore()
    const stashListCalls = sidecarMock.stashList.mock.calls.length

    const call = vi.fn().mockResolvedValue({ _tag: 'Ok' })
    let ok: boolean | undefined
    await act(async () => {
      ok = await ref.git?.runAction('stashDrop', call, 'Dropped stash')
    })

    expect(ok).toBe(true)
    await waitFor(() => {
      expect(sidecarMock.stashList.mock.calls.length).toBeGreaterThan(stashListCalls)
    })
    expect(sidecarMock.getStatus).not.toHaveBeenCalled()
    expect(sidecarMock.getLocalBranches).not.toHaveBeenCalled()
    expect(window.electronAPI.startLogStream).not.toHaveBeenCalled()
  })

  it('routes a stash apply Conflict to the resolve path and refreshes the working tree and stash', async () => {
    const ref = await openedStashStore()
    const stashListCalls = sidecarMock.stashList.mock.calls.length

    const call = vi.fn().mockResolvedValue({ _tag: 'Conflict', message: 'stash conflicts' })
    let ok: boolean | undefined
    await act(async () => {
      ok = await ref.git?.runAction('stashApply', call, 'Applied stash')
    })

    expect(ok).toBe(false)
    expect(toast.warning).toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(sidecarMock.getStatus).toHaveBeenCalledWith(repoPath)
      expect(sidecarMock.stashList.mock.calls.length).toBeGreaterThan(stashListCalls)
    })
    expect(sidecarMock.getLocalBranches).not.toHaveBeenCalled()
    expect(window.electronAPI.startLogStream).not.toHaveBeenCalled()
  })
})

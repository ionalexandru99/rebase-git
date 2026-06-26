import { renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGitActions } from '@/hooks/git/useGitActions'
import {
  type ConflictableResult,
  type RefWriteResult,
  rpcCherryPick,
  rpcCreateBranch,
  rpcCreateTag,
  rpcDeleteBranch,
  rpcDeleteTag,
  rpcMergeBranch,
  rpcRenameBranch,
  rpcRevertCommit
} from '@/lib/rpc-client'
import { type GitStore, type RepoSession, RepoSessionProvider } from '@/stores/git'

const conflictable = (wire: { _tag: string; message?: string }): ConflictableResult =>
  wire as unknown as ConflictableResult

const refWrite = (wire: { _tag: string; message?: string }): RefWriteResult =>
  wire as unknown as RefWriteResult

vi.mock('@/lib/rpc-client', () => ({
  rpcMergeBranch: vi.fn(),
  rpcRevertCommit: vi.fn(),
  rpcCherryPick: vi.fn(),
  rpcDiscardChanges: vi.fn(),
  rpcDiscardAll: vi.fn(),
  rpcCreateBranch: vi.fn(),
  rpcDeleteBranch: vi.fn(),
  rpcRenameBranch: vi.fn(),
  rpcCreateTag: vi.fn(),
  rpcDeleteTag: vi.fn()
}))

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn()
}))
vi.mock('sonner', () => ({ toast }))

const refreshAfterMutation = vi.fn().mockResolvedValue(undefined)

function makeStore(): GitStore {
  return {
    state: { repoPath: '/store-prop-should-not-be-used' },
    refreshAfterMutation,
    refreshWorkingTree: vi.fn().mockResolvedValue(undefined),
    refreshBranchesOnly: vi.fn().mockResolvedValue(undefined),
    refreshStashes: vi.fn().mockResolvedValue(undefined)
  } as unknown as GitStore
}

function makeSession(repoPath: string): RepoSession {
  return {
    repoPath,
    opening: false,
    openGeneration: 1,
    error: null,
    openRepo: vi.fn(),
    closeRepo: vi.fn()
  }
}

function actionsFor(repoPath = '/repo') {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(RepoSessionProvider, { value: makeSession(repoPath) }, children)
  const { result } = renderHook(() => useGitActions(makeStore()), { wrapper })
  return result.current
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useGitActions conflictable ops', () => {
  it('calls the typed mergeBranch caller and reports success', async () => {
    vi.mocked(rpcMergeBranch).mockResolvedValue(conflictable({ _tag: 'Ok' }))

    const ok = await actionsFor().mergeBranch('feature')

    expect(rpcMergeBranch).toHaveBeenCalledWith('/repo', 'feature')
    expect(ok).toBe(true)
    expect(refreshAfterMutation).toHaveBeenCalledWith('/repo')
  })

  it('routes a merge Conflict to the resolve path (warning, not error)', async () => {
    vi.mocked(rpcMergeBranch).mockResolvedValue(
      conflictable({
        _tag: 'Conflict',
        message: 'merge stopped on conflicts'
      })
    )

    const ok = await actionsFor().mergeBranch('feature')

    expect(ok).toBe(false)
    expect(refreshAfterMutation).toHaveBeenCalledWith('/repo')
    expect(toast.warning).toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('routes a revert Conflict to the resolve path (warning, not error)', async () => {
    vi.mocked(rpcRevertCommit).mockResolvedValue(
      conflictable({
        _tag: 'Conflict',
        message: 'revert stopped on conflicts'
      })
    )

    const ok = await actionsFor().revertCommit('abcdef1234567')

    expect(rpcRevertCommit).toHaveBeenCalledWith('/repo', 'abcdef1234567')
    expect(ok).toBe(false)
    expect(toast.warning).toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('routes a cherry-pick Conflict to the resolve path (warning, not error)', async () => {
    vi.mocked(rpcCherryPick).mockResolvedValue(
      conflictable({
        _tag: 'Conflict',
        message: 'cherry-pick stopped on conflicts'
      })
    )

    const ok = await actionsFor().cherryPick('abcdef1234567')

    expect(rpcCherryPick).toHaveBeenCalledWith('/repo', 'abcdef1234567')
    expect(ok).toBe(false)
    expect(toast.warning).toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('surfaces a GitError from a conflictable op as an error toast', async () => {
    vi.mocked(rpcCherryPick).mockResolvedValue(
      conflictable({ _tag: 'GitError', message: 'bad ref' })
    )

    const ok = await actionsFor().cherryPick('abcdef1234567')

    expect(ok).toBe(false)
    expect(toast.error).toHaveBeenCalled()
    expect(toast.warning).not.toHaveBeenCalled()
  })
})

describe('useGitActions branch & tag ops', () => {
  it('calls the typed createBranch caller and reports success', async () => {
    vi.mocked(rpcCreateBranch).mockResolvedValue(refWrite({ _tag: 'Ok' }))

    const ok = await actionsFor().createBranch('feature', 'main', true)

    expect(rpcCreateBranch).toHaveBeenCalledWith('/repo', 'feature', 'main', true)
    expect(ok).toBe(true)
    expect(toast.success).toHaveBeenCalled()
  })

  it('calls the typed deleteBranch caller and reports success', async () => {
    vi.mocked(rpcDeleteBranch).mockResolvedValue(refWrite({ _tag: 'Ok' }))

    const ok = await actionsFor().deleteBranch('feature', true)

    expect(rpcDeleteBranch).toHaveBeenCalledWith('/repo', 'feature', true)
    expect(ok).toBe(true)
  })

  it('calls the typed renameBranch caller and reports success', async () => {
    vi.mocked(rpcRenameBranch).mockResolvedValue(refWrite({ _tag: 'Ok' }))

    const ok = await actionsFor().renameBranch('old', 'new')

    expect(rpcRenameBranch).toHaveBeenCalledWith('/repo', 'old', 'new')
    expect(ok).toBe(true)
  })

  it('calls the typed createTag caller and reports success', async () => {
    vi.mocked(rpcCreateTag).mockResolvedValue(refWrite({ _tag: 'Ok' }))

    const ok = await actionsFor().createTag('v1', 'main')

    expect(rpcCreateTag).toHaveBeenCalledWith('/repo', 'v1', 'main', undefined)
    expect(ok).toBe(true)
  })

  it('calls the typed deleteTag caller and reports success', async () => {
    vi.mocked(rpcDeleteTag).mockResolvedValue(refWrite({ _tag: 'Ok' }))

    const ok = await actionsFor().deleteTag('v1')

    expect(rpcDeleteTag).toHaveBeenCalledWith('/repo', 'v1')
    expect(ok).toBe(true)
  })

  it('surfaces a GitError from a branch op as an error toast', async () => {
    vi.mocked(rpcDeleteBranch).mockResolvedValue(
      refWrite({ _tag: 'GitError', message: 'branch not found' })
    )

    const ok = await actionsFor().deleteBranch('missing')

    expect(ok).toBe(false)
    expect(toast.error).toHaveBeenCalled()
  })
})

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGitActions } from '@/hooks/git/useGitActions'
import {
  type ConflictableResult,
  rpcCherryPick,
  rpcMergeBranch,
  rpcRevertCommit
} from '@/lib/rpc-client'
import type { GitStore } from '@/stores/git'

const conflictable = (wire: { _tag: string; message?: string }): ConflictableResult =>
  wire as unknown as ConflictableResult

vi.mock('@/lib/rpc-client', () => ({
  rpcMergeBranch: vi.fn(),
  rpcRevertCommit: vi.fn(),
  rpcCherryPick: vi.fn(),
  rpcDiscardChanges: vi.fn(),
  rpcDiscardAll: vi.fn()
}))

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn()
}))
vi.mock('sonner', () => ({ toast }))

const refreshAfterMutation = vi.fn().mockResolvedValue(undefined)

function makeStore(repoPath = '/repo'): GitStore {
  return {
    state: { repoPath },
    refreshAfterMutation,
    refreshWorkingTree: vi.fn().mockResolvedValue(undefined),
    refreshBranchesOnly: vi.fn().mockResolvedValue(undefined),
    refreshStashes: vi.fn().mockResolvedValue(undefined)
  } as unknown as GitStore
}

function actionsFor(repoPath = '/repo') {
  const { result } = renderHook(() => useGitActions(makeStore(repoPath)))
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

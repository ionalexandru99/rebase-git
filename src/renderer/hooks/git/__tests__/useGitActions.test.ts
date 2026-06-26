import { renderHook } from '@testing-library/react'
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
  rpcDiscardAll,
  rpcDiscardChanges,
  rpcMergeBranch,
  rpcRenameBranch,
  rpcReset,
  rpcRevertCommit,
  rpcStashApply,
  rpcStashDrop,
  rpcStashPop,
  rpcStashPush
} from '@/lib/rpc-client'
import type { GitStore } from '@/stores/git'

const conflictable = (wire: { _tag: string; message?: string }): ConflictableResult =>
  wire as unknown as ConflictableResult

const refWrite = (wire: { _tag: string; message?: string }): RefWriteResult =>
  wire as unknown as RefWriteResult

vi.mock('@/lib/rpc-client', () => ({
  rpcMergeBranch: vi.fn(),
  rpcRevertCommit: vi.fn(),
  rpcCherryPick: vi.fn(),
  rpcReset: vi.fn(),
  rpcDiscardChanges: vi.fn(),
  rpcDiscardAll: vi.fn(),
  rpcCreateBranch: vi.fn(),
  rpcDeleteBranch: vi.fn(),
  rpcRenameBranch: vi.fn(),
  rpcCreateTag: vi.fn(),
  rpcDeleteTag: vi.fn(),
  rpcStashPush: vi.fn(),
  rpcStashApply: vi.fn(),
  rpcStashPop: vi.fn(),
  rpcStashDrop: vi.fn()
}))

// The action runner is the git store's; here it is faked to invoke the handed-off call and report
// Ok-ness, so wiring tests can assert which operation tag, call, and label each action routes
// through it. Its own invalidation/conflict/toast behavior is covered in the store harness.
const runAction = vi.fn(
  async (
    _operation: string,
    call: (path: string) => Promise<{ _tag: string }>,
    _label: string
  ): Promise<boolean> => (await call('/repo'))._tag === 'Ok'
)

function actionsFor() {
  const store = { runAction } as unknown as GitStore
  const { result } = renderHook(() => useGitActions(store))
  return result.current
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useGitActions conflictable ops route through the runner', () => {
  it('routes mergeBranch through the runner with the mapped tag, call, and label', async () => {
    vi.mocked(rpcMergeBranch).mockResolvedValue(conflictable({ _tag: 'Ok' }))

    const ok = await actionsFor().mergeBranch('feature')

    expect(runAction).toHaveBeenCalledWith('mergeBranch', expect.any(Function), 'Merged feature')
    expect(rpcMergeBranch).toHaveBeenCalledWith('/repo', 'feature')
    expect(ok).toBe(true)
  })

  it('routes revertCommit through the runner', async () => {
    vi.mocked(rpcRevertCommit).mockResolvedValue(conflictable({ _tag: 'Ok' }))

    const ok = await actionsFor().revertCommit('abcdef1234567')

    expect(runAction).toHaveBeenCalledWith('revertCommit', expect.any(Function), 'Reverted abcdef1')
    expect(rpcRevertCommit).toHaveBeenCalledWith('/repo', 'abcdef1234567')
    expect(ok).toBe(true)
  })

  it('routes cherryPick through the runner', async () => {
    vi.mocked(rpcCherryPick).mockResolvedValue(conflictable({ _tag: 'Ok' }))

    const ok = await actionsFor().cherryPick('abcdef1234567')

    expect(runAction).toHaveBeenCalledWith(
      'cherryPick',
      expect.any(Function),
      'Cherry-picked abcdef1'
    )
    expect(rpcCherryPick).toHaveBeenCalledWith('/repo', 'abcdef1234567')
    expect(ok).toBe(true)
  })

  it('routes resetToCommit through the runner', async () => {
    vi.mocked(rpcReset).mockResolvedValue(refWrite({ _tag: 'Ok' }))

    const ok = await actionsFor().resetToCommit('abcdef1234567', 'hard')

    expect(runAction).toHaveBeenCalledWith('reset', expect.any(Function), 'Reset (hard) to abcdef1')
    expect(rpcReset).toHaveBeenCalledWith('/repo', 'abcdef1234567', 'hard')
    expect(ok).toBe(true)
  })

  it('reports a conflictable op that hits conflicts as not-ok', async () => {
    vi.mocked(rpcMergeBranch).mockResolvedValue(conflictable({ _tag: 'Conflict' }))

    const ok = await actionsFor().mergeBranch('feature')

    expect(runAction).toHaveBeenCalledWith('mergeBranch', expect.any(Function), 'Merged feature')
    expect(ok).toBe(false)
  })
})

describe('useGitActions branch & tag ops route through the runner', () => {
  it('routes createBranch+checkout through the runner with the switched label', async () => {
    vi.mocked(rpcCreateBranch).mockResolvedValue(refWrite({ _tag: 'Ok' }))

    const ok = await actionsFor().createBranch('feature', 'main', true)

    expect(runAction).toHaveBeenCalledWith(
      'createBranchCheckout',
      expect.any(Function),
      'Created and switched to feature'
    )
    expect(rpcCreateBranch).toHaveBeenCalledWith('/repo', 'feature', 'main', true)
    expect(ok).toBe(true)
  })

  it('routes a no-checkout createBranch with the plain label', async () => {
    vi.mocked(rpcCreateBranch).mockResolvedValue(refWrite({ _tag: 'Ok' }))

    await actionsFor().createBranch('feature')

    expect(runAction).toHaveBeenCalledWith(
      'createBranch',
      expect.any(Function),
      'Created branch feature'
    )
    expect(rpcCreateBranch).toHaveBeenCalledWith('/repo', 'feature', undefined, undefined)
  })

  it('routes deleteBranch through the runner', async () => {
    vi.mocked(rpcDeleteBranch).mockResolvedValue(refWrite({ _tag: 'Ok' }))

    const ok = await actionsFor().deleteBranch('feature', true)

    expect(runAction).toHaveBeenCalledWith(
      'deleteBranch',
      expect.any(Function),
      'Deleted branch feature'
    )
    expect(rpcDeleteBranch).toHaveBeenCalledWith('/repo', 'feature', true)
    expect(ok).toBe(true)
  })

  it('routes renameBranch through the runner', async () => {
    vi.mocked(rpcRenameBranch).mockResolvedValue(refWrite({ _tag: 'Ok' }))

    const ok = await actionsFor().renameBranch('old', 'new')

    expect(runAction).toHaveBeenCalledWith(
      'renameBranch',
      expect.any(Function),
      'Renamed old to new'
    )
    expect(rpcRenameBranch).toHaveBeenCalledWith('/repo', 'old', 'new')
    expect(ok).toBe(true)
  })

  it('routes createTag through the runner', async () => {
    vi.mocked(rpcCreateTag).mockResolvedValue(refWrite({ _tag: 'Ok' }))

    const ok = await actionsFor().createTag('v1', 'main')

    expect(runAction).toHaveBeenCalledWith('createTag', expect.any(Function), 'Created tag v1')
    expect(rpcCreateTag).toHaveBeenCalledWith('/repo', 'v1', 'main', undefined)
    expect(ok).toBe(true)
  })

  it('routes deleteTag through the runner', async () => {
    vi.mocked(rpcDeleteTag).mockResolvedValue(refWrite({ _tag: 'Ok' }))

    const ok = await actionsFor().deleteTag('v1')

    expect(runAction).toHaveBeenCalledWith('deleteTag', expect.any(Function), 'Deleted tag v1')
    expect(rpcDeleteTag).toHaveBeenCalledWith('/repo', 'v1')
    expect(ok).toBe(true)
  })
})

describe('useGitActions working-tree & stash ops route through the runner', () => {
  it('routes discardChanges through the runner with the caller-supplied label', async () => {
    vi.mocked(rpcDiscardChanges).mockResolvedValue(refWrite({ _tag: 'Ok' }))

    const ok = await actionsFor().discardChanges(['a.ts'], 'Discarded a.ts')

    expect(runAction).toHaveBeenCalledWith('discardChanges', expect.any(Function), 'Discarded a.ts')
    expect(rpcDiscardChanges).toHaveBeenCalledWith('/repo', ['a.ts'])
    expect(ok).toBe(true)
  })

  it('routes discardAll through the runner', async () => {
    vi.mocked(rpcDiscardAll).mockResolvedValue(refWrite({ _tag: 'Ok' }))

    const ok = await actionsFor().discardAll()

    expect(runAction).toHaveBeenCalledWith(
      'discardAll',
      expect.any(Function),
      'Discarded all changes'
    )
    expect(rpcDiscardAll).toHaveBeenCalledWith('/repo')
    expect(ok).toBe(true)
  })

  it('routes stashPush through the runner', async () => {
    vi.mocked(rpcStashPush).mockResolvedValue(refWrite({ _tag: 'Ok' }))

    const ok = await actionsFor().stashPush('wip', true, ['a.ts'])

    expect(runAction).toHaveBeenCalledWith('stashPush', expect.any(Function), 'Stashed changes')
    expect(rpcStashPush).toHaveBeenCalledWith('/repo', 'wip', true, ['a.ts'])
    expect(ok).toBe(true)
  })

  it('routes stashApply through the runner', async () => {
    vi.mocked(rpcStashApply).mockResolvedValue(conflictable({ _tag: 'Ok' }))

    const ok = await actionsFor().stashApply(2)

    expect(runAction).toHaveBeenCalledWith('stashApply', expect.any(Function), 'Applied stash')
    expect(rpcStashApply).toHaveBeenCalledWith('/repo', 2)
    expect(ok).toBe(true)
  })

  it('routes stashPop through the runner', async () => {
    vi.mocked(rpcStashPop).mockResolvedValue(conflictable({ _tag: 'Ok' }))

    const ok = await actionsFor().stashPop(1)

    expect(runAction).toHaveBeenCalledWith('stashPop', expect.any(Function), 'Popped stash')
    expect(rpcStashPop).toHaveBeenCalledWith('/repo', 1)
    expect(ok).toBe(true)
  })

  it('routes stashDrop through the runner', async () => {
    vi.mocked(rpcStashDrop).mockResolvedValue(refWrite({ _tag: 'Ok' }))

    const ok = await actionsFor().stashDrop(0)

    expect(runAction).toHaveBeenCalledWith('stashDrop', expect.any(Function), 'Dropped stash')
    expect(rpcStashDrop).toHaveBeenCalledWith('/repo', 0)
    expect(ok).toBe(true)
  })
})

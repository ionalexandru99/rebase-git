import { describe, expect, it, vi } from 'vitest'
import {
  rpcCheckout,
  rpcCherryPick,
  rpcCommit,
  rpcCreateBranch,
  rpcCreateTag,
  rpcDeleteBranch,
  rpcDeleteTag,
  rpcFetch,
  rpcGetCommitStats,
  rpcGetWorkingTreeStats,
  rpcMergeBranch,
  rpcOpenRepo,
  rpcPull,
  rpcPush,
  rpcRenameBranch,
  rpcReset,
  rpcRevertCommit,
  rpcStageFile,
  rpcStageHunk,
  rpcStashApply,
  rpcStashDrop,
  rpcStashPop,
  rpcStashPush
} from '@/lib/rpc-client'
import { sidecarMock } from '../../../test/setup'

describe('rpcOpenRepo', () => {
  it('decodes the Electron-mediated response with the same contract result schema', async () => {
    vi.mocked(window.electronAPI.openRepo).mockResolvedValue({
      _tag: 'Ok',
      result: { path: '/repo', remotes: { origin: 'git@example.com:acme/app.git' } }
    })

    const result = await rpcOpenRepo('/repo', 7)

    expect(window.electronAPI.openRepo).toHaveBeenCalledWith('/repo', 7)
    expect(result).toEqual({
      _tag: 'Ok',
      result: { path: '/repo', remotes: { origin: 'git@example.com:acme/app.git' } }
    })
  })
})

describe('rpcCommit', () => {
  it('decodes a typed Ok result from the contract-derived wire shape', async () => {
    vi.mocked(sidecarMock.commit).mockResolvedValue({
      _tag: 'Ok',
      result: {
        commit: 'abc1234',
        branch: 'main',
        summary: { changes: 1, insertions: 2, deletions: 0 }
      }
    })

    const result = await rpcCommit('/repo', 'a message')

    expect(sidecarMock.commit).toHaveBeenCalledWith('/repo', 'a message')
    expect(result._tag).toBe('Ok')
    if (result._tag === 'Ok') {
      expect(result.result.commit).toBe('abc1234')
      expect(result.result.summary.insertions).toBe(2)
    }
  })

  it('surfaces a domain GitError as a typed result rather than rejecting', async () => {
    vi.mocked(sidecarMock.commit).mockResolvedValue({
      _tag: 'GitError',
      message: 'nothing to commit'
    })

    const result = await rpcCommit('/repo', 'a message')

    expect(result._tag).toBe('GitError')
    if (result._tag === 'GitError') {
      expect(result.message).toBe('nothing to commit')
    }
  })

  it('surfaces a domain RepoNotOpen as a typed result', async () => {
    vi.mocked(sidecarMock.commit).mockResolvedValue({ _tag: 'RepoNotOpen' })

    const result = await rpcCommit('/repo', 'a message')

    expect(result._tag).toBe('RepoNotOpen')
  })

  it('rejects when the call fails at the infrastructure boundary', async () => {
    vi.mocked(sidecarMock.commit).mockRejectedValue(new Error("sidecar RPC 'commit' failed"))

    await expect(rpcCommit('/repo', 'a message')).rejects.toThrow("sidecar RPC 'commit' failed")
  })

  it('rejects a malformed success response at the renderer boundary', async () => {
    vi.mocked(window.electronAPI.sidecarRequest).mockResolvedValue({ _tag: 'Ok' })

    await expect(rpcCommit('/repo', 'a message')).rejects.toThrow()
  })
})

describe('rpcStageFile', () => {
  it('sends the file payload under the stageFile tag and decodes a void Ok', async () => {
    vi.mocked(window.electronAPI.sidecarRequest).mockResolvedValue({ _tag: 'Ok' })

    const result = await rpcStageFile('/repo', 'a.txt')

    expect(window.electronAPI.sidecarRequest).toHaveBeenCalledWith('stageFile', {
      repoPath: '/repo',
      file: 'a.txt'
    })
    expect(result._tag).toBe('Ok')
  })

  it('surfaces a domain GitError as a typed result rather than rejecting', async () => {
    vi.mocked(window.electronAPI.sidecarRequest).mockResolvedValue({
      _tag: 'GitError',
      message: 'invalid repository path'
    })

    const result = await rpcStageFile('/repo', 'a.txt')

    expect(result._tag).toBe('GitError')
    if (result._tag === 'GitError') {
      expect(result.message).toBe('invalid repository path')
    }
  })
})

describe('rpcStageHunk', () => {
  it('decodes a typed HunkNotFound from the contract-derived wire shape', async () => {
    vi.mocked(window.electronAPI.sidecarRequest).mockResolvedValue({ _tag: 'HunkNotFound' })

    const result = await rpcStageHunk('/repo', 'a.txt', '@@ -1 +1 @@')

    expect(window.electronAPI.sidecarRequest).toHaveBeenCalledWith('stageHunk', {
      repoPath: '/repo',
      file: 'a.txt',
      hunkHeader: '@@ -1 +1 @@'
    })
    expect(result._tag).toBe('HunkNotFound')
  })
})

describe('rpcMergeBranch', () => {
  it('sends the selected ref identity under the mergeBranch tag and decodes a void Ok', async () => {
    vi.mocked(window.electronAPI.sidecarRequest).mockResolvedValue({ _tag: 'Ok' })

    const result = await rpcMergeBranch('/repo', 'remote', 'origin/feature')

    expect(window.electronAPI.sidecarRequest).toHaveBeenCalledWith('mergeBranch', {
      repoPath: '/repo',
      refKind: 'remote',
      fullPath: 'origin/feature'
    })
    expect(result._tag).toBe('Ok')
  })

  it('decodes a typed Conflict result with its message', async () => {
    vi.mocked(window.electronAPI.sidecarRequest).mockResolvedValue({
      _tag: 'Conflict',
      message: 'merge stopped on conflicts'
    })

    const result = await rpcMergeBranch('/repo', 'local', 'feature')

    expect(result._tag).toBe('Conflict')
    if (result._tag === 'Conflict') {
      expect(result.message).toBe('merge stopped on conflicts')
    }
  })

  it('rejects when the call fails at the infrastructure boundary', async () => {
    vi.mocked(window.electronAPI.sidecarRequest).mockRejectedValue(
      new Error("sidecar RPC 'mergeBranch' failed")
    )

    await expect(rpcMergeBranch('/repo', 'local', 'feature')).rejects.toThrow(
      "sidecar RPC 'mergeBranch' failed"
    )
  })
})

describe('rpcRevertCommit', () => {
  it('sends the sha under the revertCommit tag and decodes a void Ok', async () => {
    vi.mocked(window.electronAPI.sidecarRequest).mockResolvedValue({ _tag: 'Ok' })

    const result = await rpcRevertCommit('/repo', 'abc1234')

    expect(window.electronAPI.sidecarRequest).toHaveBeenCalledWith('revertCommit', {
      repoPath: '/repo',
      sha: 'abc1234'
    })
    expect(result._tag).toBe('Ok')
  })

  it('decodes a typed Conflict result rather than a generic GitError', async () => {
    vi.mocked(window.electronAPI.sidecarRequest).mockResolvedValue({
      _tag: 'Conflict',
      message: 'revert stopped on conflicts'
    })

    const result = await rpcRevertCommit('/repo', 'abc1234')

    expect(result._tag).toBe('Conflict')
  })
})

describe('rpcCherryPick', () => {
  it('sends the sha under the cherryPick tag and decodes a typed Conflict', async () => {
    vi.mocked(window.electronAPI.sidecarRequest).mockResolvedValue({
      _tag: 'Conflict',
      message: 'cherry-pick stopped on conflicts'
    })

    const result = await rpcCherryPick('/repo', 'abc1234')

    expect(window.electronAPI.sidecarRequest).toHaveBeenCalledWith('cherryPick', {
      repoPath: '/repo',
      sha: 'abc1234'
    })
    expect(result._tag).toBe('Conflict')
  })
})

describe('rpcCheckout', () => {
  it('sends the refKind/fullPath under the checkout tag and decodes the checked-out ref', async () => {
    vi.mocked(window.electronAPI.sidecarRequest).mockResolvedValue({
      _tag: 'Ok',
      checkedOut: 'feature'
    })

    const result = await rpcCheckout('/repo', 'local', 'feature')

    expect(window.electronAPI.sidecarRequest).toHaveBeenCalledWith('checkout', {
      repoPath: '/repo',
      refKind: 'local',
      fullPath: 'feature'
    })
    expect(result._tag).toBe('Ok')
    if (result._tag === 'Ok') {
      expect(result.checkedOut).toBe('feature')
    }
  })

  it('surfaces a domain GitError as a typed result rather than rejecting', async () => {
    vi.mocked(window.electronAPI.sidecarRequest).mockResolvedValue({
      _tag: 'GitError',
      message: 'invalid ref name'
    })

    const result = await rpcCheckout('/repo', 'local', 'feature')

    expect(result._tag).toBe('GitError')
  })
})

describe('rpcCreateBranch', () => {
  it('sends the start-point ref kind so an ambiguous ref keeps its identity', async () => {
    vi.mocked(window.electronAPI.sidecarRequest).mockResolvedValue({ _tag: 'Ok' })

    await rpcCreateBranch('/repo', 'release-fix', 'v1', true, 'tag')

    expect(window.electronAPI.sidecarRequest).toHaveBeenCalledWith('createBranch', {
      repoPath: '/repo',
      name: 'release-fix',
      startPoint: 'v1',
      startPointKind: 'tag',
      checkout: true
    })
  })

  it('sends the branch payload under the createBranch tag and decodes a void Ok', async () => {
    vi.mocked(window.electronAPI.sidecarRequest).mockResolvedValue({ _tag: 'Ok' })

    const result = await rpcCreateBranch('/repo', 'feature', 'main', true)

    expect(window.electronAPI.sidecarRequest).toHaveBeenCalledWith('createBranch', {
      repoPath: '/repo',
      name: 'feature',
      startPoint: 'main',
      checkout: true
    })
    expect(result._tag).toBe('Ok')
  })

  it('surfaces a domain GitError as a typed result rather than rejecting', async () => {
    vi.mocked(window.electronAPI.sidecarRequest).mockResolvedValue({
      _tag: 'GitError',
      message: 'invalid branch name'
    })

    const result = await rpcCreateBranch('/repo', 'feature')

    expect(result._tag).toBe('GitError')
  })
})

describe('rpcDeleteBranch', () => {
  it('sends the name/force under the deleteBranch tag and decodes a void Ok', async () => {
    vi.mocked(window.electronAPI.sidecarRequest).mockResolvedValue({ _tag: 'Ok' })

    const result = await rpcDeleteBranch('/repo', 'feature', true)

    expect(window.electronAPI.sidecarRequest).toHaveBeenCalledWith('deleteBranch', {
      repoPath: '/repo',
      name: 'feature',
      force: true
    })
    expect(result._tag).toBe('Ok')
  })
})

describe('rpcRenameBranch', () => {
  it('sends oldName/newName under the renameBranch tag and decodes a void Ok', async () => {
    vi.mocked(window.electronAPI.sidecarRequest).mockResolvedValue({ _tag: 'Ok' })

    const result = await rpcRenameBranch('/repo', 'old', 'new')

    expect(window.electronAPI.sidecarRequest).toHaveBeenCalledWith('renameBranch', {
      repoPath: '/repo',
      oldName: 'old',
      newName: 'new'
    })
    expect(result._tag).toBe('Ok')
  })
})

describe('rpcCreateTag', () => {
  it('sends the target ref kind so an ambiguous ref keeps its identity', async () => {
    vi.mocked(window.electronAPI.sidecarRequest).mockResolvedValue({ _tag: 'Ok' })

    await rpcCreateTag('/repo', 'release', 'main', undefined, 'remote')

    expect(window.electronAPI.sidecarRequest).toHaveBeenCalledWith('createTag', {
      repoPath: '/repo',
      name: 'release',
      ref: 'main',
      refKind: 'remote',
      message: undefined
    })
  })

  it('sends the tag payload under the createTag tag and decodes a void Ok', async () => {
    vi.mocked(window.electronAPI.sidecarRequest).mockResolvedValue({ _tag: 'Ok' })

    const result = await rpcCreateTag('/repo', 'v1', 'main', 'release')

    expect(window.electronAPI.sidecarRequest).toHaveBeenCalledWith('createTag', {
      repoPath: '/repo',
      name: 'v1',
      ref: 'main',
      message: 'release'
    })
    expect(result._tag).toBe('Ok')
  })
})

describe('rpcDeleteTag', () => {
  it('sends the name under the deleteTag tag and decodes a void Ok', async () => {
    vi.mocked(window.electronAPI.sidecarRequest).mockResolvedValue({ _tag: 'Ok' })

    const result = await rpcDeleteTag('/repo', 'v1')

    expect(window.electronAPI.sidecarRequest).toHaveBeenCalledWith('deleteTag', {
      repoPath: '/repo',
      name: 'v1'
    })
    expect(result._tag).toBe('Ok')
  })
})

describe('rpcStashApply', () => {
  it('sends the expected OID under the stashApply tag and decodes a void Ok', async () => {
    vi.mocked(window.electronAPI.sidecarRequest).mockResolvedValue({ _tag: 'Ok' })

    const result = await rpcStashApply('/repo', 2, 'stash-oid-2')

    expect(window.electronAPI.sidecarRequest).toHaveBeenCalledWith('stashApply', {
      repoPath: '/repo',
      index: 2,
      expectedOid: 'stash-oid-2'
    })
    expect(result._tag).toBe('Ok')
  })

  it('decodes a typed Conflict result with its message', async () => {
    vi.mocked(window.electronAPI.sidecarRequest).mockResolvedValue({
      _tag: 'Conflict',
      message: 'stash apply hit conflicts'
    })

    const result = await rpcStashApply('/repo', 0, 'stash-oid-0')

    expect(result._tag).toBe('Conflict')
    if (result._tag === 'Conflict') {
      expect(result.message).toBe('stash apply hit conflicts')
    }
  })
})

describe('rpcStashPop', () => {
  it('sends the expected OID under the stashPop tag and decodes a typed Conflict', async () => {
    vi.mocked(window.electronAPI.sidecarRequest).mockResolvedValue({
      _tag: 'Conflict',
      message: 'stash pop hit conflicts'
    })

    const result = await rpcStashPop('/repo', 1, 'stash-oid-1')

    expect(window.electronAPI.sidecarRequest).toHaveBeenCalledWith('stashPop', {
      repoPath: '/repo',
      index: 1,
      expectedOid: 'stash-oid-1'
    })
    expect(result._tag).toBe('Conflict')
  })
})

describe('rpcStashDrop', () => {
  it('sends the expected OID under the stashDrop tag and decodes a void Ok', async () => {
    vi.mocked(window.electronAPI.sidecarRequest).mockResolvedValue({ _tag: 'Ok' })

    const result = await rpcStashDrop('/repo', 0, 'stash-oid-0')

    expect(window.electronAPI.sidecarRequest).toHaveBeenCalledWith('stashDrop', {
      repoPath: '/repo',
      index: 0,
      expectedOid: 'stash-oid-0'
    })
    expect(result._tag).toBe('Ok')
  })
})

describe('rpcStashPush', () => {
  it('sends the message/includeUntracked/files under the stashPush tag and decodes a void Ok', async () => {
    vi.mocked(window.electronAPI.sidecarRequest).mockResolvedValue({ _tag: 'Ok' })

    const result = await rpcStashPush('/repo', 'wip', true, ['a.txt'])

    expect(window.electronAPI.sidecarRequest).toHaveBeenCalledWith('stashPush', {
      repoPath: '/repo',
      message: 'wip',
      includeUntracked: true,
      files: ['a.txt']
    })
    expect(result._tag).toBe('Ok')
  })

  it('surfaces a domain GitError as a typed result rather than rejecting', async () => {
    vi.mocked(window.electronAPI.sidecarRequest).mockResolvedValue({
      _tag: 'GitError',
      message: 'nothing to stash'
    })

    const result = await rpcStashPush('/repo')

    expect(result._tag).toBe('GitError')
  })
})

describe('rpcReset', () => {
  it('sends the sha/mode under the reset tag and decodes a void Ok', async () => {
    vi.mocked(window.electronAPI.sidecarRequest).mockResolvedValue({ _tag: 'Ok' })

    const result = await rpcReset('/repo', 'abc1234', 'hard')

    expect(window.electronAPI.sidecarRequest).toHaveBeenCalledWith('reset', {
      repoPath: '/repo',
      sha: 'abc1234',
      mode: 'hard'
    })
    expect(result._tag).toBe('Ok')
  })
})

describe('rpcFetch', () => {
  it('sends the repoPath under the fetch tag and decodes a void Ok', async () => {
    vi.mocked(window.electronAPI.sidecarRequest).mockResolvedValue({ _tag: 'Ok' })

    const result = await rpcFetch('/repo')

    expect(window.electronAPI.sidecarRequest).toHaveBeenCalledWith('fetch', { repoPath: '/repo' })
    expect(result._tag).toBe('Ok')
  })

  it('decodes a typed FetchSkipped result rather than rejecting', async () => {
    vi.mocked(window.electronAPI.sidecarRequest).mockResolvedValue({ _tag: 'FetchSkipped' })

    const result = await rpcFetch('/repo')

    expect(result._tag).toBe('FetchSkipped')
  })

  it('surfaces a domain GitError as a typed result', async () => {
    vi.mocked(window.electronAPI.sidecarRequest).mockResolvedValue({
      _tag: 'GitError',
      message: 'fetch failed'
    })

    const result = await rpcFetch('/repo')

    expect(result._tag).toBe('GitError')
  })
})

describe('rpcPush', () => {
  it('sends the repoPath under the push tag and decodes a void Ok', async () => {
    vi.mocked(window.electronAPI.sidecarRequest).mockResolvedValue({ _tag: 'Ok' })

    const result = await rpcPush('/repo')

    expect(window.electronAPI.sidecarRequest).toHaveBeenCalledWith('push', { repoPath: '/repo' })
    expect(result._tag).toBe('Ok')
  })
})

describe('rpcPull', () => {
  it('sends the repoPath under the pull tag and decodes a void Ok', async () => {
    vi.mocked(window.electronAPI.sidecarRequest).mockResolvedValue({ _tag: 'Ok' })

    const result = await rpcPull('/repo')

    expect(window.electronAPI.sidecarRequest).toHaveBeenCalledWith('pull', { repoPath: '/repo' })
    expect(result._tag).toBe('Ok')
  })
})

describe('rpcGetCommitStats', () => {
  it('sends the batch under the getCommitStats tag and decodes the totals', async () => {
    vi.mocked(window.electronAPI.sidecarRequest).mockResolvedValue({
      _tag: 'Ok',
      stats: [{ sha: 'abc1234', additions: 12, deletions: 3 }]
    })

    const result = await rpcGetCommitStats('/repo', ['abc1234'])

    expect(window.electronAPI.sidecarRequest).toHaveBeenCalledWith('getCommitStats', {
      repoPath: '/repo',
      shas: ['abc1234']
    })
    expect(result._tag).toBe('Ok')
    if (result._tag === 'Ok') {
      expect(result.stats).toEqual([{ sha: 'abc1234', additions: 12, deletions: 3 }])
    }
  })
})

describe('rpcGetWorkingTreeStats', () => {
  it('sends the repoPath under the getWorkingTreeStats tag and decodes the totals', async () => {
    vi.mocked(window.electronAPI.sidecarRequest).mockResolvedValue({
      _tag: 'Ok',
      additions: 4,
      deletions: 1
    })

    const result = await rpcGetWorkingTreeStats('/repo')

    expect(window.electronAPI.sidecarRequest).toHaveBeenCalledWith('getWorkingTreeStats', {
      repoPath: '/repo'
    })
    expect(result._tag).toBe('Ok')
    if (result._tag === 'Ok') {
      expect(result.additions).toBe(4)
      expect(result.deletions).toBe(1)
    }
  })
})

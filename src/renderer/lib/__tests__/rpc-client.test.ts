import { describe, expect, it, vi } from 'vitest'
import { sidecarMock } from '@/../test/setup'
import {
  rpcCherryPick,
  rpcCommit,
  rpcMergeBranch,
  rpcRevertCommit,
  rpcStageFile,
  rpcStageHunk
} from '@/lib/rpc-client'

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
  it('sends the ref under the mergeBranch tag and decodes a void Ok', async () => {
    vi.mocked(window.electronAPI.sidecarRequest).mockResolvedValue({ _tag: 'Ok' })

    const result = await rpcMergeBranch('/repo', 'feature')

    expect(window.electronAPI.sidecarRequest).toHaveBeenCalledWith('mergeBranch', {
      repoPath: '/repo',
      ref: 'feature'
    })
    expect(result._tag).toBe('Ok')
  })

  it('decodes a typed Conflict result with its message', async () => {
    vi.mocked(window.electronAPI.sidecarRequest).mockResolvedValue({
      _tag: 'Conflict',
      message: 'merge stopped on conflicts'
    })

    const result = await rpcMergeBranch('/repo', 'feature')

    expect(result._tag).toBe('Conflict')
    if (result._tag === 'Conflict') {
      expect(result.message).toBe('merge stopped on conflicts')
    }
  })

  it('rejects when the call fails at the infrastructure boundary', async () => {
    vi.mocked(window.electronAPI.sidecarRequest).mockRejectedValue(
      new Error("sidecar RPC 'mergeBranch' failed")
    )

    await expect(rpcMergeBranch('/repo', 'feature')).rejects.toThrow(
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

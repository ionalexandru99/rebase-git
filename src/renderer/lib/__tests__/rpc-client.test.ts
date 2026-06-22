import { describe, expect, it, vi } from 'vitest'
import { sidecarMock } from '@/../test/setup'
import { rpcCommit } from '@/lib/rpc-client'

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

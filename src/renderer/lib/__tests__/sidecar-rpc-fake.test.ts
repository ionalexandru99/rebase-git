import { Commit, GetStatus } from '@shared/rpc'
import { describe, expect, it, vi } from 'vitest'
import { statusResponse } from '../../../test/builders'
import { createSidecarRpcFake } from '../../../test/sidecar-rpc-fake'

describe('sidecar RPC fake', () => {
  it('routes a contract payload to its typed response handler', async () => {
    const fake = createSidecarRpcFake()
    const handler = vi.fn(({ repoPath, message }) => ({
      _tag: 'Ok' as const,
      result: {
        commit: `${repoPath}:${message}`,
        branch: 'main',
        summary: { changes: 1, insertions: 1, deletions: 0 }
      }
    }))
    fake.respond(Commit, handler)

    await expect(
      fake.request('commit', { repoPath: '/repo', message: 'typed request' })
    ).resolves.toMatchObject({
      _tag: 'Ok',
      result: { commit: '/repo:typed request' }
    })
    expect(handler).toHaveBeenCalledWith({ repoPath: '/repo', message: 'typed request' })
  })

  it('rejects an operation without an explicit response handler', async () => {
    const fake = createSidecarRpcFake()

    await expect(fake.request(GetStatus._tag, { repoPath: '/repo' })).rejects.toThrow(
      "Unexpected sidecar RPC 'getStatus'"
    )
  })

  it('removes registered handlers on reset', async () => {
    const fake = createSidecarRpcFake()
    fake.respond(GetStatus, () => statusResponse())
    fake.reset()

    await expect(fake.request(GetStatus._tag, { repoPath: '/repo' })).rejects.toThrow(
      "Unexpected sidecar RPC 'getStatus'"
    )
  })
})

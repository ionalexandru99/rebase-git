import { StatusResponseSchema } from '@shared/schemas/ipc'
import { describe, expect, it, vi } from 'vitest'
import { sidecarMock } from '@/../test/setup'
import { sidecarFetch } from '@/lib/sidecar-fetch'

describe('sidecarFetch', () => {
  it('calls the sidecar mock and parses response', async () => {
    const payload = {
      _tag: 'Ok' as const,
      status: {
        current: 'main',
        modified: [],
        staged: [],
        not_added: [],
        conflicted: [],
        deleted: [],
        created: [],
        renamed: [],
        files: []
      }
    }
    vi.mocked(sidecarMock.getStatus).mockResolvedValue(payload)

    const result = await sidecarFetch('get-status', { repoPath: '/repo' }, StatusResponseSchema)

    expect(sidecarMock.getStatus).toHaveBeenCalledWith('/repo')
    expect(result).toEqual(payload)
  })

  it('propagates sidecar errors', async () => {
    vi.mocked(sidecarMock.getStatus).mockRejectedValue(new Error('sidecar failed'))

    await expect(
      sidecarFetch('get-status', { repoPath: '/repo' }, StatusResponseSchema)
    ).rejects.toThrow('sidecar failed')
  })
})

import { SidecarOp } from '@shared/sidecar-ops'
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

    const result = await sidecarFetch(SidecarOp.getStatus, { repoPath: '/repo' })

    expect(sidecarMock.getStatus).toHaveBeenCalledWith('/repo')
    expect(result).toEqual(payload)
  })

  it('propagates sidecar errors', async () => {
    vi.mocked(sidecarMock.getStatus).mockRejectedValue(new Error('sidecar failed'))

    await expect(sidecarFetch(SidecarOp.getStatus, { repoPath: '/repo' })).rejects.toThrow(
      'sidecar failed'
    )
  })

  it('rejects payloads that do not match the op response contract', async () => {
    vi.mocked(sidecarMock.getStatus).mockResolvedValue({ _tag: 'Ok' } as never)

    await expect(sidecarFetch(SidecarOp.getStatus, { repoPath: '/repo' })).rejects.toThrow()
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

vi.unmock('@/lib/sidecar-fetch')

import { resetSidecarConfigForTests, sidecarFetch } from '@/lib/sidecar-fetch'

const OkSchema = z.object({ _tag: z.literal('Ok'), value: z.string() })

afterEach(() => {
  vi.unstubAllGlobals()
  resetSidecarConfigForTests()
  vi.mocked(window.electronAPI.getSidecarConfig).mockReset()
})

describe('sidecarFetch', () => {
  it('posts to /op/<name> with bearer auth and returns parsed JSON', async () => {
    vi.mocked(window.electronAPI.getSidecarConfig).mockResolvedValue({
      baseUrl: 'http://sidecar.test',
      token: 'secret'
    })
    const payload = { _tag: 'Ok' as const, value: 'done' }
    const fetchMock = vi.fn((_url: string | URL, _init?: RequestInit) =>
      Promise.resolve(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await sidecarFetch('get-status', { repoPath: '/repo' }, OkSchema)

    expect(result).toEqual(payload)
    const [url, requestInit] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('http://sidecar.test/op/get-status')
    expect(requestInit?.method).toBe('POST')
    expect(new Headers(requestInit?.headers).get('authorization')).toBe('Bearer secret')
  })

  it('throws when HTTP status is not ok', async () => {
    vi.mocked(window.electronAPI.getSidecarConfig).mockResolvedValue({
      baseUrl: 'http://sidecar.test',
      token: 'secret'
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('nope', { status: 500 })))
    )

    await expect(sidecarFetch('get-status', { repoPath: '/repo' }, OkSchema)).rejects.toThrow(
      /HTTP 500/
    )
  })
})

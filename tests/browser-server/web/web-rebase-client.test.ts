import { describe, expect, it, vi } from 'vitest'
import { createWebRebaseClient } from '../../../src/web/features/server-connection'

const bootstrapResponse = {
  environment: {
    environmentId: 'local',
    path: '/work/rebase-git'
  },
  readOnly: false,
  csrfToken: 'csrf-must-stay-inside-the-adapter'
}

describe('WebRebaseClient', () => {
  it('loads browser-safe bootstrap state from the same-origin Server', async () => {
    const fetchRequest = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(bootstrapResponse), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    )
    const reload = vi.fn()
    const signal = new AbortController().signal
    const client = createWebRebaseClient({
      fetch: fetchRequest,
      reload,
      rendererBuildId: 'renderer-build-a',
      serverInstanceId: 'server-instance-a'
    })

    await expect(client.loadBootstrap(signal)).resolves.toEqual({
      environment: {
        environmentId: 'local',
        path: '/work/rebase-git'
      },
      readOnly: false
    })

    expect(fetchRequest).toHaveBeenCalledOnce()
    const [url, request] = fetchRequest.mock.calls[0]
    const headers = new Headers(request?.headers)
    expect(url).toBe('/api/bootstrap')
    expect(request?.method).toBe('GET')
    expect(request?.credentials).toBe('same-origin')
    expect(request?.signal).toBe(signal)
    expect(headers.get('accept')).toBe('application/json')
    expect(headers.get('x-rebase-renderer-build-id')).toBe('renderer-build-a')
    expect(headers.get('x-rebase-server-instance-id')).toBe('server-instance-a')
    expect(headers.has('x-rebase-csrf-token')).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it.each([401, 409])('performs a full reload after a %s response', async (status) => {
    const fetchRequest = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }))
    const reload = vi.fn()
    const client = createWebRebaseClient({
      fetch: fetchRequest,
      reload,
      rendererBuildId: 'renderer-build-a',
      serverInstanceId: 'server-instance-a'
    })

    await expect(client.loadBootstrap()).rejects.toThrow('Rebase client must reload')
    expect(reload).toHaveBeenCalledOnce()
  })

  it('reports other Server failures without reloading or exposing the response body', async () => {
    const fetchRequest = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('agent-token-secret', { status: 503 }))
    const reload = vi.fn()
    const client = createWebRebaseClient({
      fetch: fetchRequest,
      reload,
      rendererBuildId: 'renderer-build-a',
      serverInstanceId: 'server-instance-a'
    })

    await expect(client.loadBootstrap()).rejects.toThrow('Server request failed with status 503')
    await expect(client.loadBootstrap()).rejects.not.toThrow('agent-token-secret')
    expect(reload).not.toHaveBeenCalled()
  })
})

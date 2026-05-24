import { FetchHttpClient } from '@effect/platform'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GitClient, GitClientLive, SidecarConfig } from '@/lib/git-client'

const config = Layer.succeed(SidecarConfig, { baseUrl: 'http://sidecar.test', token: 'secret' })
const layer = GitClientLive.pipe(Layer.provide(FetchHttpClient.layer), Layer.provide(config))

const run = (op: string, body: Record<string, unknown>) =>
  ManagedRuntime.make(layer).runPromise(
    GitClient.pipe(Effect.flatMap((git) => git.request(op, body)))
  )

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GitClient', () => {
  it('posts to /op/<name> with bearer auth and returns the parsed JSON body', async () => {
    const payload = { _tag: 'Ok', status: { current: 'main' } }
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await run('get-status', { repoPath: '/repo' })

    expect(result).toEqual(payload)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toBe('http://sidecar.test/op/get-status')
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer secret')
  })

  it('fails in the typed error channel when the transport rejects', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('connection refused')
    })
    vi.stubGlobal('fetch', fetchMock)

    const exit = await ManagedRuntime.make(layer).runPromiseExit(
      GitClient.pipe(Effect.flatMap((git) => git.request('get-status', { repoPath: '/repo' })))
    )

    expect(exit._tag).toBe('Failure')
  })
})

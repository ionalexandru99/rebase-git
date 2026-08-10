import { createServer } from 'node:http'
import { Effect } from 'effect4'
import { describe, expect, it, vi } from 'vitest'
import {
  BrowserServerFailure,
  type BrowserEnvironmentConnection,
  createFakeEnvironmentConnection,
  startBrowserServer
} from '../../../src/server/features/browser-server'
import { createWebBuild } from './browser-server-harness'

describe('Browser Server loopback listener', () => {
  it('fails precisely when the requested loopback port is occupied', async () => {
    const occupied = createServer()
    const port = await new Promise<number>((resolve, reject) => {
      occupied.once('error', reject)
      occupied.listen({ host: '127.0.0.1', port: 0 }, () => {
        const address = occupied.address()
        if (!address || typeof address === 'string') {
          reject(new TypeError('Expected a TCP listener'))
          return
        }
        resolve(address.port)
      })
    })
    const webRoot = await createWebBuild()
    const close = vi.fn()
    const environmentConnection: BrowserEnvironmentConnection = {
      loadBootstrap: () =>
        Effect.succeed({
          environment: { environmentId: 'local', path: process.cwd() },
          readOnly: false
        }),
      close: () => Effect.sync(close)
    }

    const attempt = Effect.runPromise(
      Effect.scoped(
        startBrowserServer({
          environmentConnection,
          port,
          webRoot
        })
      )
    )

    await expect(attempt).rejects.toMatchObject({
      _tag: 'BrowserServerFailure',
      message: `Loopback port ${port} is already in use`
    } satisfies Partial<BrowserServerFailure>)
    expect(close).toHaveBeenCalledOnce()
    await new Promise<void>((resolve) => occupied.close(() => resolve()))
  })

  it('refuses a Web build from a different product version', async () => {
    const webRoot = await createWebBuild('renderer-build-test', '9.9.9')

    const attempt = Effect.runPromise(
      Effect.scoped(
        startBrowserServer({
          environmentConnection: createFakeEnvironmentConnection({
            initialPath: process.cwd(),
            readOnly: false
          }),
          webRoot
        })
      )
    )

    await expect(attempt).rejects.toMatchObject({
      _tag: 'RendererBuildFailure',
      message: 'Could not load the exact Web build'
    })
  })
})

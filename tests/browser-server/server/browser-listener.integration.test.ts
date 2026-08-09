import { createServer } from 'node:http'
import { Effect } from 'effect4'
import { describe, expect, it } from 'vitest'
import {
  BrowserServerFailure,
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

    const attempt = Effect.runPromise(
      Effect.scoped(
        startBrowserServer({
          environmentConnection: createFakeEnvironmentConnection({
            initialPath: process.cwd(),
            readOnly: false
          }),
          port,
          webRoot
        })
      )
    )

    await expect(attempt).rejects.toMatchObject({
      _tag: 'BrowserServerFailure',
      message: `Loopback port ${port} is already in use`
    } satisfies Partial<BrowserServerFailure>)
    await new Promise<void>((resolve) => occupied.close(() => resolve()))
  })
})

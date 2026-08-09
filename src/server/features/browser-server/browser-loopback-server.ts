import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { Data, Effect, type Scope } from 'effect4'
import { createBrowserHttpHandler } from './browser-http-handler'
import { createClientSessionAuthority } from './client-session-authority'
import type { BrowserEnvironmentConnection } from './environment-connection'
import { loadRendererBuild, type RendererBuildFailure } from './renderer-build'

declare const __REBASE_PRODUCT_VERSION__: string

export const SERVER_PRODUCT_VERSION =
  typeof __REBASE_PRODUCT_VERSION__ === 'string' ? __REBASE_PRODUCT_VERSION__ : '0.0.1'

export class BrowserServerFailure extends Data.TaggedError('BrowserServerFailure')<{
  readonly message: string
  readonly detail?: unknown
}> {}

export interface RunningBrowserServer {
  readonly authority: string
  readonly browserUrl: string
  readonly mintBrowserUrl: () => string
  readonly origin: string
  readonly port: number
  readonly rendererBuildId: string
  readonly serverInstanceId: string
}

export interface StartBrowserServerOptions {
  readonly bootstrapFailureLimit?: number
  readonly environmentConnection: BrowserEnvironmentConnection
  readonly nonceTtlMs?: number
  readonly now?: () => number
  readonly port?: number
  readonly webRoot: string
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (detail: Error) => {
      server.off('listening', onListening)
      reject(detail)
    }
    const onListening = () => {
      server.off('error', onError)
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new TypeError('Browser Server did not expose a TCP address'))
        return
      }
      resolve(address.port)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen({ host: '127.0.0.1', port })
  })
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve()
      return
    }
    server.close(() => resolve())
    server.closeAllConnections()
  })
}

function browserServerBindFailure(detail: unknown, requestedPort: number): BrowserServerFailure {
  const errorCode =
    typeof detail === 'object' && detail !== null && 'code' in detail
      ? Reflect.get(detail, 'code')
      : undefined
  const message =
    errorCode === 'EADDRINUSE' && requestedPort !== 0
      ? `Loopback port ${requestedPort} is already in use`
      : `Could not bind Rebase Server to loopback${
          requestedPort === 0 ? '' : ` on port ${requestedPort}`
        }`
  return new BrowserServerFailure({ message, detail })
}

export function startBrowserServer(
  options: StartBrowserServerOptions
): Effect.Effect<RunningBrowserServer, BrowserServerFailure | RendererBuildFailure, Scope.Scope> {
  return Effect.gen(function* () {
    const rendererBuild = yield* loadRendererBuild(options.webRoot, SERVER_PRODUCT_VERSION)
    const environmentBootstrap = yield* options.environmentConnection.loadBootstrap()
    const server = createServer()
    const port = yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: () => listen(server, options.port ?? 0),
        catch: (detail) => browserServerBindFailure(detail, options.port ?? 0)
      }),
      () => Effect.promise(() => close(server))
    )
    yield* Effect.addFinalizer(() => options.environmentConnection.close())
    const serverInstanceId = randomUUID()
    const hostname = `rebase-${serverInstanceId.replaceAll('-', '')}.localhost`
    const authority = `${hostname}:${port}`
    const origin = `http://${authority}`
    const clientSessions = createClientSessionAuthority({
      nonceTtlMs: options.nonceTtlMs ?? 60_000,
      now: options.now ?? Date.now,
      rendererBuildId: rendererBuild.rendererBuildId,
      serverInstanceId
    })
    const browserTicket = clientSessions.mintBrowserTicket()
    const handler = createBrowserHttpHandler({
      authority,
      bootstrapFailureLimit: options.bootstrapFailureLimit ?? 8,
      clientSessions,
      cookieName: 'rebase-client',
      environmentBootstrap,
      now: options.now ?? Date.now,
      origin,
      rendererBuild,
      serverInstanceId
    })
    server.on('request', (request, response) => {
      void handler(request, response).catch(() => {
        if (!response.headersSent) {
          response.statusCode = 500
        }
        response.end()
      })
    })
    return {
      authority,
      browserUrl: `${origin}/auth/${browserTicket}`,
      mintBrowserUrl: () => `${origin}/auth/${clientSessions.mintBrowserTicket()}`,
      origin,
      port,
      rendererBuildId: rendererBuild.rendererBuildId,
      serverInstanceId
    }
  })
}

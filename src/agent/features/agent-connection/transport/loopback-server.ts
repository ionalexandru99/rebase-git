import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { AGENT_LOOPBACK_HOST } from '@common/features/agent-connection'
import { Data, Effect, type Scope } from 'effect4'

export class AgentLoopbackBindFailure extends Data.TaggedError('AgentLoopbackBindFailure')<{
  readonly host: typeof AGENT_LOOPBACK_HOST
  readonly port: number
  readonly message: string
  readonly detail: Error
}> {}

function webHeaders(headers: IncomingHttpHeaders): Headers {
  const result = new Headers()
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        result.append(name, item)
      }
    } else if (value !== undefined) {
      result.set(name, value)
    }
  }
  return result
}

function awaitServerClose(server: Server): Effect.Effect<void> {
  return Effect.callback<void>((resume) => {
    let completed = false
    const finish = () => {
      if (completed) {
        return
      }
      completed = true
      resume(Effect.void)
    }
    server.close(finish)
    server.closeIdleConnections()
    return Effect.sync(() => {
      completed = true
    })
  })
}

function closeServer(server: Server, graceMs: number): Effect.Effect<void> {
  return Effect.raceFirst(
    awaitServerClose(server),
    Effect.sleep(graceMs).pipe(
      Effect.andThen(Effect.sync(() => server.closeAllConnections())),
      Effect.andThen(awaitServerClose(server))
    )
  )
}

export function serveLoopback(
  handler: (request: Request) => Promise<Response>,
  port: number,
  shutdownGraceMs: number
): Effect.Effect<number, AgentLoopbackBindFailure, Scope.Scope> {
  return Effect.acquireRelease(
    Effect.callback<{ readonly server: Server; readonly port: number }, AgentLoopbackBindFailure>(
      (resume) => {
        let boundPort = port
        const server = createServer((request, response) => {
          const controller = new AbortController()
          const abort = () => controller.abort()
          const abortIncompleteResponse = () => {
            if (!response.writableFinished) {
              abort()
            }
          }
          request.once('aborted', abort)
          response.once('close', abortIncompleteResponse)
          const method = request.method ?? 'GET'
          const body = method === 'GET' || method === 'HEAD' ? undefined : Readable.toWeb(request)
          const webRequest = new Request(
            `http://${AGENT_LOOPBACK_HOST}:${boundPort}${request.url ?? '/'}`,
            {
              method,
              headers: webHeaders(request.headers),
              body: body as BodyInit | undefined,
              signal: controller.signal,
              duplex: body ? 'half' : undefined
            } as RequestInit & { duplex?: 'half' }
          )
          void handler(webRequest)
            .then(async (webResponse) => {
              const headers: Record<string, string> = {}
              webResponse.headers.forEach((value, name) => {
                headers[name] = value
              })
              response.writeHead(webResponse.status, headers)
              if (webResponse.body) {
                await pipeline(
                  Readable.fromWeb(webResponse.body as Parameters<typeof Readable.fromWeb>[0]),
                  response,
                  { signal: controller.signal }
                )
              } else {
                response.end()
              }
            })
            .catch(() => {
              if (!response.headersSent && !response.destroyed) {
                response.writeHead(500, { 'content-type': 'application/json' })
                response.end('{"_tag":"AgentTransportRejected","reason":"InternalError"}')
              }
            })
            .finally(() => {
              request.off('aborted', abort)
              response.off('close', abortIncompleteResponse)
            })
        })
        const fail = (error: Error) =>
          resume(
            Effect.fail(
              new AgentLoopbackBindFailure({
                host: AGENT_LOOPBACK_HOST,
                port,
                message: `Agent could not bind ${AGENT_LOOPBACK_HOST}:${port}`,
                detail: error
              })
            )
          )
        server.once('error', fail)
        server.listen(port, AGENT_LOOPBACK_HOST, () => {
          server.off('error', fail)
          boundPort = (server.address() as AddressInfo).port
          resume(
            Effect.succeed({
              server,
              port: boundPort
            })
          )
        })
        return Effect.sync(() => server.close())
      }
    ),
    ({ server }) => closeServer(server, shutdownGraceMs)
  ).pipe(Effect.map((running) => running.port))
}

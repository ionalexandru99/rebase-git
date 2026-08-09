import { Effect, FileSystem } from 'effect4'
import { HttpServerRequest } from 'effect4/unstable/http'

export function readRequestBody(
  request: HttpServerRequest.HttpServerRequest,
  maxBytes: number
): Effect.Effect<string, 'RequestTooLarge'> {
  return request.text.pipe(
    Effect.provideService(HttpServerRequest.MaxBodySize, FileSystem.Size(maxBytes)),
    Effect.mapError(() => 'RequestTooLarge' as const),
    Effect.flatMap((body) =>
      Buffer.byteLength(body) <= maxBytes
        ? Effect.succeed(body)
        : Effect.fail('RequestTooLarge' as const)
    )
  )
}

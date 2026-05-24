import { HttpClient, HttpClientRequest } from '@effect/platform'
import { Context, Effect, Layer } from 'effect'

export interface SidecarConfigShape {
  readonly baseUrl: string
  readonly token: string
}

export class SidecarConfig extends Context.Tag('SidecarConfig')<
  SidecarConfig,
  SidecarConfigShape
>() {}

export const SidecarConfigFromIpc = Layer.effect(
  SidecarConfig,
  Effect.promise(() => window.electronAPI.getSidecarConfig())
)

export interface GitClientShape {
  readonly request: (op: string, body: Record<string, unknown>) => Effect.Effect<unknown, Error>
}

export class GitClient extends Context.Tag('GitClient')<GitClient, GitClientShape>() {}

const toError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause))

export const GitClientLive = Layer.effect(
  GitClient,
  Effect.gen(function* () {
    const config = yield* SidecarConfig
    const http = yield* HttpClient.HttpClient
    return {
      request: (op, body) =>
        HttpClientRequest.post(`${config.baseUrl}/op/${op}`).pipe(
          HttpClientRequest.setHeader('authorization', `Bearer ${config.token}`),
          HttpClientRequest.bodyUnsafeJson(body),
          http.execute,
          Effect.flatMap((response) => response.json),
          Effect.mapError(toError)
        )
    }
  })
)

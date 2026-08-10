import { Effect } from 'effect4'

export interface BrowserEnvironmentConnection {
  readonly loadBootstrap: () => Effect.Effect<{
    readonly environment: {
      readonly environmentId: 'local'
      readonly path: string
    }
    readonly readOnly: boolean
  }>
  readonly close: () => Effect.Effect<void>
}

export function createFakeEnvironmentConnection(options: {
  readonly initialPath: string
  readonly readOnly: boolean
}): BrowserEnvironmentConnection {
  return {
    loadBootstrap: () =>
      Effect.succeed({
        environment: { environmentId: 'local', path: options.initialPath },
        readOnly: options.readOnly
      }),
    close: () => Effect.void
  }
}

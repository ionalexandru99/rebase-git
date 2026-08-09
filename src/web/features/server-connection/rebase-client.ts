export interface ClientBootstrap {
  readonly environment: {
    readonly environmentId: 'local'
    readonly path: string
  }
  readonly readOnly: boolean
}

export interface RebaseClient {
  readonly loadBootstrap: (signal?: AbortSignal) => Promise<ClientBootstrap>
}

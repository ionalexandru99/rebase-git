import type { ClientBootstrap as ClientBootstrapWire } from '@common/features/client-connection'

export type ClientBootstrap = Omit<ClientBootstrapWire, 'csrfToken'>

export interface RebaseClient {
  readonly loadBootstrap: (signal?: AbortSignal) => Promise<ClientBootstrap>
}

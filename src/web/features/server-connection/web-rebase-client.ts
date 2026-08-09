import {
  CLIENT_BOOTSTRAP_PATH,
  CLIENT_CSRF_HEADER,
  ClientBootstrapSchema,
  RENDERER_BUILD_HEADER,
  SERVER_INSTANCE_HEADER
} from '@common/features/client-connection'
import { Schema } from 'effect4'
import type { RebaseClient } from './rebase-client'

interface WebRebaseClientOptions {
  readonly fetch: typeof fetch
  readonly reload: () => void
  readonly rendererBuildId: string
  readonly serverInstanceId: string
}

export function createWebRebaseClient(options: WebRebaseClientOptions): RebaseClient {
  let csrfToken: string | null = null

  const request = async (
    path: string,
    method: 'GET' | 'POST',
    signal?: AbortSignal
  ): Promise<Response> => {
    const headers = new Headers({
      Accept: 'application/json',
      [RENDERER_BUILD_HEADER]: options.rendererBuildId,
      [SERVER_INSTANCE_HEADER]: options.serverInstanceId
    })
    if (method === 'POST' && csrfToken !== null) {
      headers.set(CLIENT_CSRF_HEADER, csrfToken)
    }
    const response = await options.fetch(path, {
      method,
      credentials: 'same-origin',
      headers,
      signal
    })
    if (response.status === 401 || response.status === 409) {
      options.reload()
      throw new Error('Rebase client must reload')
    }
    if (!response.ok) {
      throw new Error(`Server request failed with status ${response.status}`)
    }
    return response
  }

  return {
    loadBootstrap: async (signal) => {
      const response = await request(CLIENT_BOOTSTRAP_PATH, 'GET', signal)
      const bootstrap = Schema.decodeUnknownSync(ClientBootstrapSchema)(await response.json())
      csrfToken = bootstrap.csrfToken
      return {
        environment: bootstrap.environment,
        readOnly: bootstrap.readOnly
      }
    }
  }
}

export function createDocumentRebaseClient(document: Document): RebaseClient {
  const serverInstanceId = document
    .querySelector<HTMLMetaElement>('meta[name="rebase-server-instance-id"]')
    ?.content.trim()
  if (!serverInstanceId) {
    throw new Error('Server instance identity is missing')
  }
  return createWebRebaseClient({
    fetch: window.fetch.bind(window),
    reload: () => window.location.reload(),
    rendererBuildId: __REBASE_RENDERER_BUILD_ID__,
    serverInstanceId
  })
}

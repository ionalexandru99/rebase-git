import type { ClientBootstrap, RebaseClient } from './rebase-client'

const BOOTSTRAP_PATH = '/api/bootstrap'
const CSRF_HEADER = 'X-Rebase-CSRF-Token'

interface BootstrapResponse extends ClientBootstrap {
  readonly csrfToken: string
}

interface WebRebaseClientOptions {
  readonly fetch: typeof fetch
  readonly reload: () => void
  readonly rendererBuildId: string
  readonly serverInstanceId: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function decodeBootstrapResponse(value: unknown): BootstrapResponse {
  if (!isRecord(value) || !isRecord(value.environment)) {
    throw new Error('Server returned an invalid bootstrap response')
  }
  const { environment } = value
  if (
    environment.environmentId !== 'local' ||
    typeof environment.path !== 'string' ||
    environment.path.length === 0 ||
    typeof value.readOnly !== 'boolean' ||
    typeof value.csrfToken !== 'string' ||
    value.csrfToken.length === 0
  ) {
    throw new Error('Server returned an invalid bootstrap response')
  }
  return {
    environment: {
      environmentId: environment.environmentId,
      path: environment.path
    },
    readOnly: value.readOnly,
    csrfToken: value.csrfToken
  }
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
      'X-Rebase-Renderer-Build-Id': options.rendererBuildId,
      'X-Rebase-Server-Instance-Id': options.serverInstanceId
    })
    if (method === 'POST' && csrfToken !== null) {
      headers.set(CSRF_HEADER, csrfToken)
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
      const response = await request(BOOTSTRAP_PATH, 'GET', signal)
      const bootstrap = decodeBootstrapResponse(await response.json())
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

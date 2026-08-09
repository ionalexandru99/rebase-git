import type { IncomingMessage } from 'node:http'
import {
  CLIENT_CSRF_HEADER,
  RENDERER_BUILD_HEADER,
  SERVER_INSTANCE_HEADER
} from '@common/features/client-connection'
import type { ClientSession, ClientSessionAuthority } from './client-session-authority'

export type RequestSecurityFailure =
  | 'csrf-rejected'
  | 'host-rejected'
  | 'origin-rejected'
  | 'session-rejected'
  | 'stale-client'

function rawHeaderValues(request: IncomingMessage, headerName: string): string[] {
  const values: string[] = []
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index].toLowerCase() === headerName) {
      values.push(request.rawHeaders[index + 1])
    }
  }
  return values
}

export function validateRequestAuthority(
  request: IncomingMessage,
  expectedAuthority: string,
  expectedOrigin: string
): RequestSecurityFailure | undefined {
  const hostHeaders = rawHeaderValues(request, 'host')
  if (hostHeaders.length !== 1 || hostHeaders[0] !== expectedAuthority) {
    return 'host-rejected'
  }
  const originHeaders = rawHeaderValues(request, 'origin')
  const method = request.method ?? 'GET'
  const originRequired = !['GET', 'HEAD'].includes(method)
  if (
    originHeaders.length > 1 ||
    (originRequired && originHeaders.length !== 1) ||
    (originHeaders.length === 1 && originHeaders[0] !== expectedOrigin)
  ) {
    return 'origin-rejected'
  }
  return undefined
}

export function isStaleServerApplicationRequest(
  request: IncomingMessage,
  currentAuthority: string
): boolean {
  const separatorIndex = currentAuthority.lastIndexOf(':')
  const currentPort = currentAuthority.slice(separatorIndex + 1)
  const hostHeaders = rawHeaderValues(request, 'host')
  const instanceHeaders = rawHeaderValues(request, SERVER_INSTANCE_HEADER.toLowerCase())
  if (hostHeaders.length !== 1 || instanceHeaders.length !== 1) {
    return false
  }
  const instanceId = instanceHeaders[0]
  const instanceHostname = instanceId.replaceAll('-', '')
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(instanceId) &&
    hostHeaders[0] === `rebase-${instanceHostname}.localhost:${currentPort}`
  )
}

export function authorizeNavigationRequest(options: {
  readonly authority: ClientSessionAuthority
  readonly cookieName: string
  readonly request: IncomingMessage
}): { readonly session: ClientSession } | { readonly failure: 'session-rejected' } {
  const token = sessionTokenFromCookie(options.request, options.cookieName)
  const session = token ? options.authority.findSession(token) : undefined
  return session ? { session } : { failure: 'session-rejected' }
}

function sessionTokenFromCookie(request: IncomingMessage, cookieName: string): string | undefined {
  const cookieHeaders = rawHeaderValues(request, 'cookie')
  if (cookieHeaders.length !== 1) {
    return undefined
  }
  const matchingValues = cookieHeaders[0]
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${cookieName}=`))
    .map((part) => part.slice(cookieName.length + 1))
  return matchingValues.length === 1 ? matchingValues[0] : undefined
}

export function authorizeApplicationRequest(options: {
  readonly authority: ClientSessionAuthority
  readonly cookieName: string
  readonly request: IncomingMessage
  readonly rendererBuildId: string
  readonly serverInstanceId: string
}): { readonly session: ClientSession } | { readonly failure: RequestSecurityFailure } {
  const token = sessionTokenFromCookie(options.request, options.cookieName)
  const session = token ? options.authority.findSession(token) : undefined
  if (!session) {
    return { failure: 'session-rejected' }
  }
  if (
    options.request.headers[RENDERER_BUILD_HEADER.toLowerCase()] !== options.rendererBuildId ||
    options.request.headers[SERVER_INSTANCE_HEADER.toLowerCase()] !== options.serverInstanceId ||
    session.rendererBuildId !== options.rendererBuildId ||
    session.serverInstanceId !== options.serverInstanceId
  ) {
    return { failure: 'stale-client' }
  }
  const method = options.request.method ?? 'GET'
  if (!['GET', 'HEAD'].includes(method)) {
    const csrfHeader = options.request.headers[CLIENT_CSRF_HEADER.toLowerCase()]
    if (typeof csrfHeader !== 'string' || csrfHeader !== session.csrfToken) {
      return { failure: 'csrf-rejected' }
    }
  }
  return { session }
}

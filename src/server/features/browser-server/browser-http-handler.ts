import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  authorizeApplicationRequest,
  authorizeNavigationRequest,
  type RequestSecurityFailure,
  validateRequestAuthority
} from './browser-request-security'
import type { ClientSessionAuthority } from './client-session-authority'
import type { RendererBuild } from './renderer-build'

const contentSecurityPolicy = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ')

function applySecurityHeaders(response: ServerResponse): void {
  response.setHeader('Content-Security-Policy', contentSecurityPolicy)
  response.setHeader('Referrer-Policy', 'no-referrer')
  response.setHeader('X-Content-Type-Options', 'nosniff')
}

function send(
  response: ServerResponse,
  statusCode: number,
  body = '',
  contentType = 'text/plain; charset=utf-8'
): void {
  applySecurityHeaders(response)
  response.statusCode = statusCode
  response.setHeader('Content-Type', contentType)
  response.setHeader('Content-Length', Buffer.byteLength(body))
  response.end(body)
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  send(response, statusCode, JSON.stringify(value), 'application/json; charset=utf-8')
}

function securityStatus(failure: RequestSecurityFailure): number {
  if (failure === 'stale-client') {
    return 409
  }
  if (failure === 'session-rejected') {
    return 401
  }
  return 403
}

function mimeType(filePath: string): string {
  if (filePath.endsWith('.js')) {
    return 'text/javascript; charset=utf-8'
  }
  if (filePath.endsWith('.css')) {
    return 'text/css; charset=utf-8'
  }
  if (filePath.endsWith('.svg')) {
    return 'image/svg+xml'
  }
  if (filePath.endsWith('.ico')) {
    return 'image/x-icon'
  }
  if (filePath.endsWith('.json')) {
    return 'application/json; charset=utf-8'
  }
  return 'application/octet-stream'
}

function isImmutableAsset(filePath: string): boolean {
  return /^assets\/.+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(filePath)
}

function normalizedStaticPath(pathname: string): string | undefined {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return undefined
  }
  if (decoded.includes('\\') || decoded.split('/').includes('..')) {
    return undefined
  }
  return decoded.replace(/^\//, '')
}

function hasUnsafeRequestTarget(requestTarget: string): boolean {
  const pathname = requestTarget.split(/[?#]/, 1)[0]
  try {
    const decoded = decodeURIComponent(pathname)
    return decoded.includes('\\') || decoded.split('/').includes('..')
  } catch {
    return true
  }
}

export function createBrowserHttpHandler(options: {
  readonly authority: string
  readonly bootstrapFailureLimit: number
  readonly browserTicket: string
  readonly clientSessions: ClientSessionAuthority
  readonly cookieName: string
  readonly environmentBootstrap: {
    readonly environment: { readonly environmentId: 'local'; readonly path: string }
    readonly readOnly: boolean
  }
  readonly origin: string
  readonly now: () => number
  readonly rendererBuild: RendererBuild
  readonly serverInstanceId: string
}): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  let browserTicketAvailable = true
  const bootstrapFailures = new Map<string, number[]>()
  const rejectBrowserTicket = (request: IncomingMessage, response: ServerResponse): void => {
    const remoteAddress = request.socket.remoteAddress ?? 'loopback'
    const cutoff = options.now() - 60_000
    const recentFailures = (bootstrapFailures.get(remoteAddress) ?? []).filter(
      (failureAt) => failureAt >= cutoff
    )
    if (recentFailures.length >= options.bootstrapFailureLimit) {
      send(response, 429)
      return
    }
    recentFailures.push(options.now())
    bootstrapFailures.set(remoteAddress, recentFailures)
    if (bootstrapFailures.size > 128) {
      bootstrapFailures.delete(bootstrapFailures.keys().next().value ?? remoteAddress)
    }
    send(response, 404)
  }
  return async (request, response) => {
    const authorityFailure = validateRequestAuthority(request, options.authority, options.origin)
    if (authorityFailure) {
      sendJson(response, 403, { error: authorityFailure })
      return
    }
    const requestTarget = request.url
    if (
      !requestTarget?.startsWith('/') ||
      requestTarget.startsWith('//') ||
      hasUnsafeRequestTarget(requestTarget)
    ) {
      sendJson(response, 400, { error: 'invalid-request-target' })
      return
    }
    const requestUrl = new URL(requestTarget, options.origin)
    if (request.method === 'OPTIONS') {
      send(response, 405)
      return
    }
    if (requestUrl.pathname === '/.well-known/rebase/health') {
      send(response, request.method === 'GET' || request.method === 'HEAD' ? 204 : 405)
      return
    }
    if (requestUrl.pathname.startsWith('/auth/')) {
      if (request.method !== 'GET') {
        send(response, 405)
        return
      }
      const suppliedTicket = requestUrl.pathname.slice('/auth/'.length)
      if (!browserTicketAvailable || suppliedTicket !== options.browserTicket) {
        rejectBrowserTicket(request, response)
        return
      }
      browserTicketAvailable = false
      const exchange = options.clientSessions.exchangeBrowserTicket(suppliedTicket)
      if (!exchange.accepted) {
        rejectBrowserTicket(request, response)
        return
      }
      applySecurityHeaders(response)
      response.statusCode = 303
      response.setHeader('Cache-Control', 'no-store')
      response.setHeader('Location', '/')
      response.setHeader(
        'Set-Cookie',
        `${options.cookieName}=${exchange.sessionToken}; Path=/; HttpOnly; SameSite=Strict`
      )
      response.end()
      return
    }
    if (requestUrl.pathname === '/api/bootstrap') {
      const authorization = authorizeApplicationRequest({
        authority: options.clientSessions,
        cookieName: options.cookieName,
        rendererBuildId: options.rendererBuild.rendererBuildId,
        request,
        serverInstanceId: options.serverInstanceId
      })
      if ('failure' in authorization) {
        sendJson(response, securityStatus(authorization.failure), {
          error: authorization.failure,
          reload: authorization.failure === 'stale-client'
        })
        return
      }
      sendJson(response, 200, {
        ...options.environmentBootstrap,
        csrfToken: authorization.session.csrfToken
      })
      return
    }
    if (!['GET', 'HEAD'].includes(request.method ?? 'GET')) {
      const authorization = authorizeApplicationRequest({
        authority: options.clientSessions,
        cookieName: options.cookieName,
        rendererBuildId: options.rendererBuild.rendererBuildId,
        request,
        serverInstanceId: options.serverInstanceId
      })
      if ('failure' in authorization) {
        sendJson(response, securityStatus(authorization.failure), { error: authorization.failure })
        return
      }
      if (options.environmentBootstrap.readOnly) {
        sendJson(response, 403, { error: 'read-only' })
        return
      }
      send(response, 404)
      return
    }
    const navigationAuthorization = authorizeNavigationRequest({
      authority: options.clientSessions,
      cookieName: options.cookieName,
      request
    })
    if ('failure' in navigationAuthorization) {
      send(response, 401)
      return
    }
    const staticPath = normalizedStaticPath(requestUrl.pathname)
    if (staticPath === undefined) {
      send(response, 404)
      return
    }
    if (staticPath === '' || staticPath === 'index.html') {
      const instanceIdentityPlaceholder = '__REBASE_SERVER_INSTANCE_ID__'
      const html = options.rendererBuild.indexHtml.includes(instanceIdentityPlaceholder)
        ? options.rendererBuild.indexHtml.replaceAll(
            instanceIdentityPlaceholder,
            options.serverInstanceId
          )
        : options.rendererBuild.indexHtml.replace(
            '<head>',
            `<head><meta name="rebase-server-instance-id" content="${options.serverInstanceId}" />`
          )
      response.setHeader('Cache-Control', 'no-store')
      send(response, 200, request.method === 'HEAD' ? '' : html, 'text/html; charset=utf-8')
      return
    }
    const file = options.rendererBuild.files.get(staticPath)
    const staticPathAllowed =
      staticPath === 'rebase-manifest.json' ||
      staticPath === 'favicon.svg' ||
      staticPath === 'favicon.ico' ||
      isImmutableAsset(staticPath)
    if (!file || !staticPathAllowed) {
      send(response, 404)
      return
    }
    response.setHeader(
      'Cache-Control',
      isImmutableAsset(staticPath) ? 'public, max-age=31536000, immutable' : 'no-store'
    )
    applySecurityHeaders(response)
    response.statusCode = 200
    response.setHeader('Content-Type', mimeType(staticPath))
    response.setHeader('Content-Length', request.method === 'HEAD' ? 0 : file.byteLength)
    response.end(request.method === 'HEAD' ? undefined : file)
  }
}

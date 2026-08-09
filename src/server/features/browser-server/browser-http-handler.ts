import type { IncomingMessage, ServerResponse } from 'node:http'
import { CLIENT_BOOTSTRAP_PATH, type ClientBootstrap } from '@common/features/client-connection'
import {
  authorizeApplicationRequest,
  authorizeNavigationRequest,
  validateRequestAuthority
} from './browser-request-security'
import {
  hasUnsafeRequestTarget,
  isAllowedRendererFile,
  rendererPathname,
  requestSecurityStatus,
  sendAuthenticationRedirect,
  sendBrowserJson,
  sendBrowserResponse,
  sendRendererFile,
  sendRendererHtml
} from './browser-response'
import type { ClientSessionAuthority } from './client-session-authority'
import type { RendererBuild } from './renderer-build'

export function createBrowserHttpHandler(options: {
  readonly authority: string
  readonly bootstrapFailureLimit: number
  readonly clientSessions: ClientSessionAuthority
  readonly cookieName: string
  readonly environmentBootstrap: Omit<ClientBootstrap, 'csrfToken'>
  readonly origin: string
  readonly now: () => number
  readonly rendererBuild: RendererBuild
  readonly serverInstanceId: string
}): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  const bootstrapFailures = new Map<string, number[]>()
  const rejectBrowserTicket = (request: IncomingMessage, response: ServerResponse): void => {
    const remoteAddress = request.socket.remoteAddress ?? 'loopback'
    const cutoff = options.now() - 60_000
    const recentFailures = (bootstrapFailures.get(remoteAddress) ?? []).filter(
      (failureAt) => failureAt >= cutoff
    )
    if (recentFailures.length >= options.bootstrapFailureLimit) {
      sendBrowserResponse(response, 429)
      return
    }
    recentFailures.push(options.now())
    bootstrapFailures.set(remoteAddress, recentFailures)
    if (bootstrapFailures.size > 128) {
      bootstrapFailures.delete(bootstrapFailures.keys().next().value ?? remoteAddress)
    }
    sendBrowserResponse(response, 404)
  }
  return async (request, response) => {
    const authorityFailure = validateRequestAuthority(request, options.authority, options.origin)
    if (authorityFailure) {
      sendBrowserJson(response, 403, { error: authorityFailure })
      return
    }
    const requestTarget = request.url
    if (
      !requestTarget?.startsWith('/') ||
      requestTarget.startsWith('//') ||
      hasUnsafeRequestTarget(requestTarget)
    ) {
      sendBrowserJson(response, 400, { error: 'invalid-request-target' })
      return
    }
    const requestUrl = new URL(requestTarget, options.origin)
    if (request.method === 'OPTIONS') {
      sendBrowserResponse(response, 405)
      return
    }
    if (requestUrl.pathname === '/.well-known/rebase/health') {
      sendBrowserResponse(
        response,
        request.method === 'GET' || request.method === 'HEAD' ? 204 : 405
      )
      return
    }
    if (requestUrl.pathname.startsWith('/auth/')) {
      if (request.method !== 'GET') {
        sendBrowserResponse(response, 405)
        return
      }
      const suppliedTicket = requestUrl.pathname.slice('/auth/'.length)
      const exchange = options.clientSessions.exchangeBrowserTicket(suppliedTicket)
      if (!exchange.accepted) {
        rejectBrowserTicket(request, response)
        return
      }
      sendAuthenticationRedirect(response, `${options.cookieName}=${exchange.sessionToken}`)
      return
    }
    if (requestUrl.pathname === CLIENT_BOOTSTRAP_PATH) {
      const authorization = authorizeApplicationRequest({
        authority: options.clientSessions,
        cookieName: options.cookieName,
        rendererBuildId: options.rendererBuild.rendererBuildId,
        request,
        serverInstanceId: options.serverInstanceId
      })
      if ('failure' in authorization) {
        sendBrowserJson(response, requestSecurityStatus(authorization.failure), {
          error: authorization.failure,
          reload: authorization.failure === 'stale-client'
        })
        return
      }
      const bootstrap: ClientBootstrap = {
        ...options.environmentBootstrap,
        csrfToken: authorization.session.csrfToken
      }
      sendBrowserJson(response, 200, bootstrap)
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
        sendBrowserJson(response, requestSecurityStatus(authorization.failure), {
          error: authorization.failure
        })
        return
      }
      if (options.environmentBootstrap.readOnly) {
        sendBrowserJson(response, 403, { error: 'read-only' })
        return
      }
      sendBrowserResponse(response, 404)
      return
    }
    const navigationAuthorization = authorizeNavigationRequest({
      authority: options.clientSessions,
      cookieName: options.cookieName,
      request
    })
    if ('failure' in navigationAuthorization) {
      sendBrowserResponse(response, 401)
      return
    }
    const staticPath = rendererPathname(requestUrl.pathname)
    if (staticPath === undefined) {
      sendBrowserResponse(response, 404)
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
      sendRendererHtml(response, request.method, html)
      return
    }
    const file = options.rendererBuild.files.get(staticPath)
    if (!file || !isAllowedRendererFile(staticPath)) {
      sendBrowserResponse(response, 404)
      return
    }
    sendRendererFile(response, request.method, staticPath, file)
  }
}
